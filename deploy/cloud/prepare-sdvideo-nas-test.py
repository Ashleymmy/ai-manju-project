"""在 ECS 准备 SD-video NAS 内测配置；不启动服务、不修改现有 .env。"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import secrets
import subprocess

PROJECT = Path('/root/item/cavans/ai-manju-project')
VAULT = Path('/srv/studio-secrets/sdvideo-nas-test')
OUTPUT = Path('/root/item/compose.sdvideo-nas-test.json')
PUBLIC_MEDIA_URL = os.getenv('SDVIDEO_PUBLIC_MEDIA_URL', 'https://studio.clouddo.cc').strip().rstrip('/')
BASE_FILES = [PROJECT / name for name in (
    'docker-compose.yml', 'docker-compose.override.yml',
    'compose.nas-ipv6.yml', 'compose.nas-tokens.yml',
)] + [Path('/root/item/compose.nas-media.yml')]
SD_SERVICES = ('sd-video-api', 'sd-video-worker', 'sd-video-asset-worker')
PRIVATE_VOLUMES = {
    'sdvideo-nas-test-db': '/var/lib/postgresql/data',
    'sdvideo-nas-test-queue': '/data',
    'sdvideo-nas-test-scratch': '/app/data',
}


def run(args, *, cwd=None):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=45)
    if result.returncode:
        # 原错误可能带连接串、环境变量或密钥，不能直接回显。
        raise ValueError('命令执行失败：' + args[0] + '；原始输出已隐藏')
    return result.stdout.strip()


def compose_args(extra=None):
    args = ['docker', 'compose']
    for path in BASE_FILES + ([extra] if extra else []):
        args += ['-f', str(path)]
    return args + ['--profile', 'sd-video']


def bind(source, target):
    return {'type': 'bind', 'source': str(source), 'target': target,
            'read_only': True, 'bind': {'create_host_path': False}}


def make_overlay(image):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise ValueError('需要当前 Studio API 的本地不可变镜像 ID')
    gateway = {
        'SD_VIDEO_MODE': 'disabled',
        'SD_VIDEO_BASE_URL': 'https://sd-video-api:8201',
        'SD_VIDEO_JWT_PRIVATE_KEY': '',
        'SD_VIDEO_JWT_PRIVATE_KEY_FILE': '/run/sdvideo-client/signing.pem',
        'SD_VIDEO_JWT_KID': 'studio-sdvideo-nas-test-1',
        'SD_VIDEO_JWT_ISSUER': 'ai-manju-studio',
        'SD_VIDEO_JWT_AUDIENCE': 'sd-video',
        'SD_VIDEO_CA_FILE': '/run/sdvideo-ca.crt',
    }
    client_mounts = [bind(VAULT / 'studio', '/run/sdvideo-client'),
                     bind(VAULT / 'ca/ca.crt', '/run/sdvideo-ca.crt')]
    client_networks = {'default': {'gw_priority': 0},
                       'nas_egress': {'gw_priority': -1}, 'sdvideo_link': {}}
    runtime = {
        # production 的 readiness 明确禁止 Mock；只对独立内测服务使用 development。
        'APP_ENV': 'development', 'SDVIDEO_LOAD_ENV_FILE': 'false',
        'LOCAL_DEMO_MODE': 'false', 'LOCAL_API_TEST_MODE': 'false', 'ALLOW_CORS': 'false',
        'SD_VIDEO_MODE': 'active', 'SD_VIDEO_EXECUTION_MODE': 'mock',
        'SERVICE_JWT_PUBLIC_KEY': 'file:/run/sdvideo-secrets/verifier.pem',
        'SERVICE_JWT_ISSUER': 'ai-manju-studio', 'SERVICE_JWT_AUDIENCE': 'sd-video',
        'SERVICE_JWT_ALGORITHMS': 'EdDSA',
        'SDVIDEO_DATABASE_URL': '',
        'SDVIDEO_DATABASE_URL_FILE': '/run/sdvideo-secrets/database-url',
        'SDVIDEO_REDIS_URL': 'redis://sd-video-redis:6379/0',
        'STORAGE_BACKEND': 'supabase', 'SDVIDEO_DATA_DIR': '/app/data',
        'SDVIDEO_SUPABASE_URL': 'https://sd.ggwp.cn:18000',
        # 内部读写仍直达 NAS；Provider 使用 ECS 公网媒体反代，不能读取 NAS 内部入口。
        'SDVIDEO_SUPABASE_PUBLIC_URL': PUBLIC_MEDIA_URL,
        'SDVIDEO_SUPABASE_STORAGE_TOKEN': '',
        'SDVIDEO_SUPABASE_STORAGE_TOKEN_FILE': '/run/storage-credentials/storage-token',
        'SDVIDEO_SUPABASE_API_KEY': '', 'SDVIDEO_SUPABASE_API_KEY_FILE': '',
        'SDVIDEO_SUPABASE_CA_FILE': '',
        'SDVIDEO_WORKER_INTERVAL_SECONDS': '5', 'SDVIDEO_WORKER_MAX_ATTEMPTS': '1',
    }
    for kind, suffix in (('INPUT', 'inputs'), ('RESULT', 'results'),
                         ('THUMBNAIL', 'thumbnails'), ('VOLCANO', 'volcano')):
        runtime[f'SDVIDEO_SUPABASE_{kind}_BUCKET'] = f'studio-sdvideo-test-{suffix}'
    # 清空继承自根 Compose 的上游凭据；本轮不调用付费 Provider。
    for key in ('ARK_API_KEY', 'SEEDANCE20_KEY', 'TOKENSPACE_API_KEY', 'VIDU_API_KEY',
                'YIKE_API_KEY', 'YIKE_ACCESS_KEY_ID', 'YIKE_ACCESS_KEY_SECRET', 'AMK_API_KEY'):
        runtime[key] = ''
        runtime[key + '_FILE'] = ''
    services = {
        'api': {'environment': gateway, 'volumes': client_mounts, 'networks': client_networks},
        'sd-video-bridge': {
            'image': image, 'environment': {**gateway,
                'STUDIO_SUPABASE_STORAGE_TOKEN_FILE': '/run/storage-credentials/storage-token',
                'SD_VIDEO_BRIDGE_HEALTH_ADDR': '0.0.0.0:3103'},
            'volumes': client_mounts + [bind('/srv/studio-storage-tokens/studio', '/run/storage-credentials')],
            'group_add': ['21001'], 'networks': client_networks,
            'healthcheck': {'test': ['CMD-SHELL', 'wget -qO- http://127.0.0.1:3103/health/ready >/dev/null'],
                            'interval': '15s', 'timeout': '8s', 'retries': 5},
        },
        'sd-video-postgres': {
            'environment': {'POSTGRES_USER': 'sdvideo', 'POSTGRES_DB': 'sdvideo_cloud',
                            'POSTGRES_PASSWORD': '', 'POSTGRES_PASSWORD_FILE': '/run/db-password'},
            'volumes': ['sdvideo-nas-test-db:/var/lib/postgresql/data',
                        bind(VAULT / 'database/password', '/run/db-password')],
            'networks': {'sdvideo_private': {}}, 'restart': 'unless-stopped', 'mem_limit': '1g',
        },
        'sd-video-redis': {
            'command': ['redis-server', '--appendonly', 'yes', '--maxmemory', '256mb',
                        '--maxmemory-policy', 'noeviction'],
            'volumes': ['sdvideo-nas-test-queue:/data'], 'networks': {'sdvideo_private': {}},
            'restart': 'unless-stopped', 'mem_limit': '384m',
        },
    }
    for name in SD_SERVICES:
        services[name] = {
            'image': 'studio-sdvideo-nas-test:20260913',
            'environment': dict(runtime), 'user': '10001:10001', 'group_add': ['21002'],
            'volumes': ['sdvideo-nas-test-scratch:/app/data',
                        bind(VAULT / 'sdvideo', '/run/sdvideo-secrets'),
                        bind('/srv/studio-storage-tokens/sdvideo', '/run/storage-credentials')],
            'networks': {'sdvideo_private': {}, 'sdvideo_link': {},
                         'sdvideo_egress': {'gw_priority': 0}, 'nas_egress': {'gw_priority': -1}},
            'restart': 'unless-stopped', 'mem_limit': '2g',
            'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}},
        }
    services['sd-video-api']['volumes'].append(bind(VAULT / 'tls', '/run/sdvideo-tls'))
    services['sd-video-api']['command'] = ['sh', '-c',
        'python scripts/migrate.py && exec uvicorn api.main:app --host 0.0.0.0 --port 8201 '
        '--ssl-keyfile /run/sdvideo-tls/server.key --ssl-certfile /run/sdvideo-tls/server.crt --no-access-log']
    services['sd-video-api']['healthcheck'] = {
        'test': ['CMD', 'python', '-c', "import ssl,urllib.request; urllib.request.urlopen("
                 "'https://sd-video-api:8201/health/ready',timeout=8,"
                 "context=ssl.create_default_context(cafile='/run/sdvideo-tls/ca.crt'))"],
        'interval': '15s', 'timeout': '10s', 'retries': 12,
    }
    # readiness 的 Storage 探针最长 5 秒，不能沿用根配置的 3 秒客户端超时。
    services['sd-video-worker']['healthcheck'] = {
        'test': ['CMD', 'python', '-c', "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8202/health/ready',timeout=8)"],
        'interval': '15s', 'timeout': '10s', 'retries': 12,
    }
    return {'services': services,
            'networks': {'nas_egress': {'external': True, 'name': 'studio-nas-egress'},
                         'sdvideo_private': {'internal': True}, 'sdvideo_link': {'internal': True},
                         'sdvideo_egress': {}},
            'volumes': {name: {} for name in PRIVATE_VOLUMES}}


def write_new(path, content, mode=0o600):
    with path.open('x', encoding='utf-8', newline='\n') as handle:
        handle.write(content)
    path.chmod(mode)


def generate_credentials(root, openssl='openssl'):
    root.mkdir(mode=0o700)
    for name in ('studio', 'sdvideo', 'database', 'ca', 'tls'):
        (root / name).mkdir(mode=0o700)
    def ssl(*args):
        return run([openssl, *[str(arg) for arg in args]], cwd=root)
    ssl('genpkey', '-algorithm', 'ED25519', '-out', 'studio/signing.pem')
    ssl('pkey', '-in', 'studio/signing.pem', '-pubout', '-out', 'sdvideo/verifier.pem')
    ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '90',
        '-keyout', 'ca/ca.key', '-out', 'ca/ca.crt', '-subj', '/CN=Studio SD-video NAS test CA',
        '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
    ssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'tls/server.key',
        '-out', 'tls/server.csr', '-subj', '/CN=sd-video-api')
    write_new(root / 'tls/server.ext', 'subjectAltName=DNS:sd-video-api\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
    ssl('x509', '-req', '-in', 'tls/server.csr', '-CA', 'ca/ca.crt', '-CAkey', 'ca/ca.key',
        '-CAcreateserial', '-out', 'tls/server.crt', '-days', '90', '-sha256', '-extfile', 'tls/server.ext')
    ssl('verify', '-CAfile', 'ca/ca.crt', '-verify_hostname', 'sd-video-api', 'tls/server.crt')
    write_new(root / 'tls/ca.crt', (root / 'ca/ca.crt').read_text())
    password = secrets.token_hex(32)
    write_new(root / 'database/password', password + '\n')
    write_new(root / 'sdvideo/database-url', f'postgresql://sdvideo:{password}@sd-video-postgres:5432/sdvideo_cloud\n')


def validate_config(cfg):
    services = cfg['services']
    if services['api']['environment']['SD_VIDEO_MODE'] != 'disabled':
        raise ValueError('Studio 视频入口必须仍为 disabled')
    for name in SD_SERVICES:
        service = services[name]
        env = service['environment']
        if env['SD_VIDEO_EXECUTION_MODE'] != 'mock' or env['STORAGE_BACKEND'] != 'supabase':
            raise ValueError('视频服务不是 NAS Mock 模式')
        if service.get('ports'):
            raise ValueError('视频服务不能发布宿主端口')
    for name in ('sd-video-postgres', 'sd-video-redis'):
        if services[name].get('ports') or set(services[name]['networks']) != {'sdvideo_private'}:
            raise ValueError('视频数据库或队列没有正确隔离')


def main():
    if os.name != 'posix' or os.geteuid() != 0 or Path.cwd() != PROJECT:
        raise ValueError('请在 ECS 项目目录以 root 执行；本机不执行部署准备')
    os.umask(0o077)
    if OUTPUT.exists() or VAULT.exists():
        raise ValueError('内测配置或专属密钥目录已存在；未覆盖，请保留并核对')
    if not all(path.is_file() for path in BASE_FILES):
        raise ValueError('现有五份 Compose 文件不齐；未修改配置')
    run(['openssl', 'version'])
    for role, group in (('studio', 21001), ('sdvideo', 21002)):
        path = Path('/srv/studio-storage-tokens') / role / 'storage-token'
        stat = path.stat()
        if stat.st_gid != group or stat.st_mode & 0o777 != 0o440:
            raise ValueError(role + ' Storage Token 权限不符合现有轮换配置')
    cfg = json.loads(run(compose_args() + ['config', '--format', 'json'], cwd=PROJECT))
    if cfg['services']['api']['environment'].get('SD_VIDEO_MODE') != 'disabled':
        raise ValueError('当前视频入口不是 disabled，请先核对，未更改现有服务')
    containers = run(['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=ai-manju-project',
                      '--format', '{{.Label "com.docker.compose.service"}}']).splitlines()
    if any(name.startswith('sd-video-') for name in containers):
        raise ValueError('已有 SD-video 容器；先核对原状态，不覆盖或替换')
    volumes = run(['docker', 'volume', 'ls', '--format', '{{.Name}}']).splitlines()
    if any('ai-manju-project_' + name in volumes for name in PRIVATE_VOLUMES):
        raise ValueError('内测卷已存在；不重建、不删除，先核对原状态')
    image = run(['docker', 'inspect', 'ai-manju-project-api-1', '--format', '{{.Image}}'])
    overlay = make_overlay(image)
    VAULT.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    generate_credentials(VAULT)
    # 容器仅拿到各自的子目录，CA 私钥不会被挂载。
    for name in ('sdvideo', 'tls'):
        directory = VAULT / name
        os.chown(directory, 0, 10001)
        directory.chmod(0o750)
        for path in directory.iterdir():
            os.chown(path, 0, 10001)
            path.chmod(0o440)
    for path in (VAULT / 'studio').iterdir():
        path.chmod(0o400)
    write_new(OUTPUT, json.dumps(overlay, indent=2, ensure_ascii=False) + '\n')
    merged = json.loads(run(compose_args(OUTPUT) + ['config', '--format', 'json'], cwd=PROJECT))
    validate_config(merged)
    print('PASS：增量 Compose 配置解析通过；新服务 JWT、HTTPS 证书、独立数据库密码已生成。')
    print('PASS：仅使用新测试桶；NAS Token 目录保持不变；Studio 视频入口仍为 disabled。')
    print('尚未构建、启动或重建任何容器；尚未验证 NAS 运行时访问和真实任务。')
    print('配置文件：' + str(OUTPUT))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        # 系统异常可能带环境细节，仅受控 ValueError 提示可见。
        print('STOP：' + (str(exc) if type(exc) is ValueError else type(exc).__name__))
        print('未执行任何容器启动或重建；如已生成专属文件，请保留，勿重新生成密钥。')
        raise SystemExit(1)
