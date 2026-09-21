package handler

import (
	"encoding/csv"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/service"
)

// Prefix spreadsheet formulas without changing the displayed identifier.
func csvSafe(value string) string {
	if strings.HasPrefix(strings.TrimSpace(value), "=") || strings.HasPrefix(strings.TrimSpace(value), "+") || strings.HasPrefix(strings.TrimSpace(value), "-") || strings.HasPrefix(strings.TrimSpace(value), "@") {
		return "'" + value
	}
	return value
}
func usageCSV(rows []service.UsageRow) (string, error) {
	var out strings.Builder
	out.WriteString("\ufeff")
	w := csv.NewWriter(&out)
	if err := w.Write([]string{"任务ID", "成员ID", "账号", "昵称", "内部测试", "项目ID", "项目名称", "模型", "供应商", "状态", "创建时间UTC", "开始时间UTC", "完成时间UTC", "结算时间UTC", "积分状态", "积分报价", "已扣积分", "估算人民币微元", "实际人民币微元", "账单依据"}); err != nil {
		return "", err
	}
	stamp := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.UTC().Format(time.RFC3339Nano)
	}
	amount := func(v *int64) string {
		if v == nil {
			return ""
		}
		return strconv.FormatInt(*v, 10)
	}
	for _, r := range rows {
		values := []string{r.JobID, r.UserID, r.Username, r.DisplayName, strconv.FormatBool(r.Internal), r.ProjectID, r.ProjectName, r.Model, r.Provider, r.Status, r.CreatedAt.UTC().Format(time.RFC3339Nano), stamp(r.StartedAt), stamp(r.FinishedAt), stamp(r.SettledAt), r.CreditStatus, strconv.FormatInt(r.CreditsQuoted, 10), strconv.FormatInt(r.CreditsSettled, 10), amount(r.EstimatedCostMicros), amount(r.ActualCostMicros), r.CostReference}
		for i := range values {
			values[i] = csvSafe(values[i])
		}
		if err := w.Write(values); err != nil {
			return "", err
		}
	}
	w.Flush()
	return out.String(), w.Error()
}
