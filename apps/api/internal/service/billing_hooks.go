package service

import (
	"encoding/json"
	"log"

	"github.com/ai-manju/api/internal/model"
)

// JobBillingHooks is the seam between JobService and the credit engine.
// JobService holds a nil value when billing is disabled, preserving the
// pre-billing behavior exactly.
type JobBillingHooks interface {
	// NormalizePayloadForJob 会员权益的载荷改写（WP-M6）：非会员视频强制水印。
	// 必须在 Reserve 之前调用，使冻结价格与最终执行参数一致。
	NormalizePayloadForJob(userID string, jobType string, payload model.JSONB) (model.JSONB, error)
	// ReserveForJob prices and freezes credits for a job about to be created.
	// Free job types return nil without touching the ledger.
	ReserveForJob(userID string, jobType string, jobID string, payload model.JSONB) error
	// ReleaseForJob returns the freeze (失败/取消/入队失败). Never fails the
	// caller — settlement problems are logged and left to the reconciler.
	ReleaseForJob(jobID string)
}

// BillingHooks wires the pricer, entitlement gate, and the ledger engine into
// job submission.
type BillingHooks struct {
	pricer *CreditPricer
	engine *CreditLedgerService
	gate   *EntitlementGate
}

func NewBillingHooks(pricer *CreditPricer, engine *CreditLedgerService, gate *EntitlementGate) *BillingHooks {
	return &BillingHooks{pricer: pricer, engine: engine, gate: gate}
}

// NormalizePayloadForJob 非会员的视频生成强制 watermark=true（文档：会员权益
// 去除品牌水印；免费用户保留水印）。
func (h *BillingHooks) NormalizePayloadForJob(userID string, jobType string, payload model.JSONB) (model.JSONB, error) {
	if jobType != model.JobTypeVideoGenerate || h.gate == nil {
		return payload, nil
	}
	removeWatermark, err := h.gate.FeatureEnabled(userID, "remove_watermark")
	if err != nil {
		return payload, err
	}
	if removeWatermark {
		return payload, nil
	}
	var body map[string]any
	if len(payload) > 0 {
		if err := json.Unmarshal(payload, &body); err != nil {
			return payload, nil // 无法解析就不改写，避免破坏任务
		}
	} else {
		body = map[string]any{}
	}
	if watermark, ok := body["watermark"].(bool); ok && watermark {
		return payload, nil
	}
	body["watermark"] = true
	rewritten, err := json.Marshal(body)
	if err != nil {
		return payload, nil
	}
	return model.JSONB(rewritten), nil
}

// ReserveForJob 先过并发准入（WP-M6），再冻结积分（WP-M3）。
func (h *BillingHooks) ReserveForJob(userID string, jobType string, jobID string, payload model.JSONB) error {
	if h.gate != nil {
		if err := h.gate.CheckAdmission(userID, jobType); err != nil {
			return err
		}
	}
	credits, taskType, params, chargeable := h.pricer.QuoteForJob(jobType, payload)
	if !chargeable || credits <= 0 {
		return nil
	}
	modelName := ""
	if len(payload) > 0 {
		var body map[string]any
		if err := json.Unmarshal(payload, &body); err == nil {
			modelName = jsonString(body["model"])
		}
	}
	_, err := h.engine.Reserve(userID, CreditQuote{
		JobID:    jobID,
		TaskType: taskType,
		Model:    modelName,
		Params:   params,
		Credits:  credits,
	})
	return err
}

func (h *BillingHooks) ReleaseForJob(jobID string) {
	if _, err := h.engine.Release(jobID); err != nil {
		log.Printf("job_id=%s event=credit_release_failed reason=%q", jobID, err.Error())
	}
}
