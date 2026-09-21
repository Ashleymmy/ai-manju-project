package handler

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/ai-manju/api/internal/model"
)

// Explicit operational bounds prevent negative pricing and unusable limits.
const maxAdminPlanConcurrency = 1000
const maxAdminDiscountBps = 10000

func validateAdminPlan(p model.MembershipPlan) error {
	if strings.TrimSpace(p.Name) == "" || len(p.Name) > 200 || p.PriceMonthCents < 0 || p.PriceYearCents < 0 || p.MonthlyCredits < 0 || p.PriceMonthCents > maxAdminTestCredits || p.PriceYearCents > maxAdminTestCredits || p.MonthlyCredits > maxAdminTestCredits {
		return errors.New("invalid plan name, price or credits")
	}
	if p.ImageConcurrency < 1 || p.VideoConcurrency < 1 || p.ImageConcurrency > maxAdminPlanConcurrency || p.VideoConcurrency > maxAdminPlanConcurrency {
		return errors.New("concurrency must be between 1 and 1000")
	}
	if p.CreditDiscountBps < 1 || p.CreditDiscountBps > maxAdminDiscountBps || p.PriorityRank < 0 {
		return errors.New("invalid discount or priority")
	}
	if p.Code == model.PlanCodeInternal && p.Enabled {
		return errors.New("internal test membership cannot be publicly sold")
	}
	var features map[string]bool
	if err := json.Unmarshal(p.Features, &features); err != nil || features == nil {
		return errors.New("features must be an object of boolean values")
	}
	return nil
}
