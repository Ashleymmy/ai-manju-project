package service

import (
	"io"
	"time"
)

// 只根据实际认领扫描和媒体传输进度判断；续租心跳不能掩盖导出卡死。
const AssetExportProgressStaleAfter = 2 * time.Minute

func (s *AssetExportService) recordDispatchProgress() {
	s.dispatchProgress.Store(time.Now().UnixNano())
}

func (s *AssetExportService) DispatcherReady(now time.Time) bool {
	last := s.dispatchProgress.Load()
	return last != 0 && now.Sub(time.Unix(0, last)) <= AssetExportProgressStaleAfter
}

type exportProgressReader struct {
	reader   io.Reader
	progress func()
}

func (r exportProgressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		r.progress()
	}
	return n, err
}
