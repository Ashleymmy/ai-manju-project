package model

import "time"

// ClonedVoiceMeta 记录复刻音色的应用侧展示元数据（别名、属主）。
// 音色本体存于服务商（百炼/MiniMax）账号，应用不存副本；本表只保存
// 中文别名等展示信息，voice_id 与服务商侧一一对应。
type ClonedVoiceMeta struct {
	VoiceID     string    `json:"voice_id" gorm:"primaryKey;size:128"`
	Alias       string    `json:"alias" gorm:"size:64"`
	OwnerID     string    `json:"owner_id" gorm:"index;size:64"`
	OwnerName   string    `json:"owner_name" gorm:"size:64"`
	TargetModel string    `json:"target_model" gorm:"size:128"`
	// ReferenceAssetID 参考音频资产：即克隆即删模式下音色本体不留在服务商，
	// 每次合成用这份资产临时克隆。删除该资产会导致音色不可用。
	ReferenceAssetID string    `json:"reference_asset_id" gorm:"index;size:64"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}
