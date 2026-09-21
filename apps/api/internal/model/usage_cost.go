package model

import "time"

// Cost money is stored as millionths of CNY, independently of user credits.
const CostMicrosPerYuan int64 = 1_000_000
const CostUnitTask = "task"
const CostUnitImage = "image"
const CostUnitSecond = "second"

// ModelCostRate is an immutable, effective-dated estimate. Adding a new rate
// applies from its effective date; backdated rates can revise historical estimates.
type ModelCostRate struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	Model          string    `json:"model" gorm:"not null;index"`
	Provider       string    `json:"provider" gorm:"index"`
	Unit           string    `json:"unit" gorm:"not null"`
	UnitCostMicros int64     `json:"unit_cost_micros" gorm:"not null"`
	EffectiveAt    time.Time `json:"effective_at" gorm:"index"`
	CreatedAt      time.Time `json:"created_at"`
	OperatorID     string    `json:"operator_id"`
}

// TaskActualCost is the reconciled TOTAL cost of one task (including retries),
// not a delta. Replaying a PUT cannot increment costs. Changes are audited.
type TaskActualCost struct {
	JobID        string    `json:"job_id" gorm:"primaryKey"`
	AmountMicros int64     `json:"amount_micros" gorm:"not null"`
	Reference    string    `json:"reference" gorm:"not null"`
	OperatorID   string    `json:"operator_id"`
	UpdatedAt    time.Time `json:"updated_at"`
}
