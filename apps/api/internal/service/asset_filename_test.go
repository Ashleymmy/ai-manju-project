package service

import (
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestRenamedAssetDownloadAndExportFileNames(t *testing.T) {
	for _, tc := range []struct{ name, kind, mime, want string }{
		{"新名称", "image", "image/png", "新名称.png"},
		{"镜头1.2", "video", "video/mp4", "镜头1.2.mp4"},
		{"台词（2）", "audio", "audio/wav", "台词（2）.wav"},
		{"音乐", "audio", "audio/mp4", "音乐.m4a"},
		{"已有.JPG", "image", "image/jpeg", "已有.JPG"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			asset := model.Asset{ID: "asset", Name: tc.name, Type: tc.kind, ContentType: tc.mime}
			if got := AssetDownloadFileName(asset); got != tc.want {
				t.Fatalf("download = %q, want %q", got, tc.want)
			}
			if got := uniqueExportArchivePath(asset, "files", map[string]bool{}); got != "files/"+tc.want {
				t.Fatalf("export = %q", got)
			}
		})
	}
}
