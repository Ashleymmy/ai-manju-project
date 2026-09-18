package repository

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

// creditRepoFactory builds one fresh repository per call. The same semantic
// suite runs against Memory (always) and Gorm (when TEST_DATABASE_URL is set),
// per the project rule that both implementations must behave identically.
type creditRepoFactory func() CreditRepository

func TestMemoryCreditRepositorySemantics(t *testing.T) {
	runCreditRepositorySemantics(t, func() CreditRepository {
		return NewMemoryCreditRepository()
	}, func(suffix string) string { return suffix })
}

func TestGormCreditRepositorySemantics(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	prefix := fmt.Sprintf("credit_it_%d", time.Now().UTC().UnixNano())
	t.Cleanup(func() {
		like := prefix + "%"
		_ = db.Where("id LIKE ?", like).Delete(&model.CreditLedgerEntry{}).Error
		_ = db.Where("id LIKE ?", like).Delete(&model.TaskConsumption{}).Error
		_ = db.Where("id LIKE ?", like).Delete(&model.CreditGrant{}).Error
		_ = db.Where("user_id LIKE ?", like).Delete(&model.CreditAccount{}).Error
	})
	runCreditRepositorySemantics(t, func() CreditRepository {
		return NewGormCreditRepository(db)
	}, func(suffix string) string { return prefix + "_" + suffix })
}

func runCreditRepositorySemantics(t *testing.T, factory creditRepoFactory, ids func(string) string) {
	t.Helper()
	epoch := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	seedGrant := func(t *testing.T, repo CreditRepository, userID string, source string, amount int64, expiresAt time.Time, periodKey string) model.CreditGrant {
		t.Helper()
		outcome, err := repo.CreateGrantWithLedger(model.CreditGrant{
			UserID: userID, SourceType: source, AmountTotal: amount, AmountRemaining: amount,
			GrantedAt: epoch, ExpiresAt: expiresAt, Status: model.GrantStatusActive, PeriodKey: periodKey,
		}, model.LedgerTypeActivityBonus, "system", "", epoch)
		if err != nil {
			t.Fatalf("seed grant: %v", err)
		}
		return outcome.Grant
	}
	recharge := func(t *testing.T, repo CreditRepository, userID string, amount int64, nonce string) {
		t.Helper()
		outcome, err := repo.AdjustPermanent(userID, amount, model.LedgerTypeAdminAdd, "admin:test", nonce, epoch)
		if err != nil || !outcome.Applied {
			t.Fatalf("recharge applied=%v err=%v", outcome.Applied, err)
		}
	}
	reserve := func(t *testing.T, repo CreditRepository, userID string, jobID string, credits int64, now time.Time) ReserveOutcome {
		t.Helper()
		outcome, err := repo.Reserve(ReserveInput{JobID: jobID, UserID: userID, TaskType: model.TaskTypeImage, Model: "m", Params: model.JSONB(`{}`), Credits: credits, Now: now})
		if err != nil {
			t.Fatalf("reserve %s: %v", jobID, err)
		}
		return outcome
	}

	t.Run("ReserveFEFOConsumesEarliestExpiryFirst", func(t *testing.T) {
		repo := factory()
		userID := ids("fefo_user")
		later := seedGrant(t, repo, userID, model.GrantSourceMemberMonthly, 100, epoch.Add(60*24*time.Hour), ids("fefo_later"))
		sooner := seedGrant(t, repo, userID, model.GrantSourceMemberMonthly, 50, epoch.Add(10*24*time.Hour), ids("fefo_sooner"))

		outcome := reserve(t, repo, userID, ids("fefo_job"), 120, epoch)
		allocation, err := unmarshalAllocation(outcome.Consumption.Allocation)
		if err != nil {
			t.Fatal(err)
		}
		if len(allocation) != 2 {
			t.Fatalf("allocation lines = %d, want 2", len(allocation))
		}
		if allocation[0].GrantID != sooner.ID || allocation[0].Amount != 50 {
			t.Fatalf("first allocation = %+v, want sooner grant 50", allocation[0])
		}
		if allocation[1].GrantID != later.ID || allocation[1].Amount != 70 {
			t.Fatalf("second allocation = %+v, want later grant 70", allocation[1])
		}

		soonerAfter, _ := repo.GetGrantByID(sooner.ID)
		laterAfter, _ := repo.GetGrantByID(later.ID)
		if soonerAfter.AmountFrozen != 50 || laterAfter.AmountFrozen != 70 {
			t.Fatalf("frozen = sooner %d later %d, want 50/70", soonerAfter.AmountFrozen, laterAfter.AmountFrozen)
		}
	})

	t.Run("ReserveOverflowToPermanent", func(t *testing.T) {
		repo := factory()
		userID := ids("overflow_user")
		seedGrant(t, repo, userID, model.GrantSourceRegisterBonus, 50, epoch.Add(31*24*time.Hour), ids("overflow_grant"))
		recharge(t, repo, userID, 100, ids("overflow_recharge"))

		outcome := reserve(t, repo, userID, ids("overflow_job"), 120, epoch)
		allocation, err := unmarshalAllocation(outcome.Consumption.Allocation)
		if err != nil {
			t.Fatal(err)
		}
		if len(allocation) != 2 || allocation[0].Bucket != model.CreditBucketGrant || allocation[1].Bucket != model.CreditBucketPermanent {
			t.Fatalf("allocation = %+v, want grant then permanent", allocation)
		}
		if allocation[0].Amount != 50 || allocation[1].Amount != 70 {
			t.Fatalf("amounts = %d/%d, want 50/70", allocation[0].Amount, allocation[1].Amount)
		}
		account, _ := repo.GetAccount(userID)
		if account.PermanentFrozen != 70 || account.PermanentBalance != 100 {
			t.Fatalf("account = %+v, want balance 100 frozen 70", account)
		}
	})

	t.Run("ReserveInsufficientCredits", func(t *testing.T) {
		repo := factory()
		userID := ids("short_user")
		seedGrant(t, repo, userID, model.GrantSourceRegisterBonus, 50, epoch.Add(31*24*time.Hour), ids("short_grant"))

		_, err := repo.Reserve(ReserveInput{JobID: ids("short_job"), UserID: userID, TaskType: model.TaskTypeImage, Model: "m", Credits: 51, Now: epoch})
		if !errors.Is(err, ErrInsufficientCredits) {
			t.Fatalf("err = %v, want ErrInsufficientCredits", err)
		}
		grant, _ := repo.GetGrantByPeriodKey(ids("short_grant"))
		if grant.AmountFrozen != 0 {
			t.Fatalf("frozen = %d, want 0 after failed reserve", grant.AmountFrozen)
		}
	})

	t.Run("ReserveDuplicateJobIsIdempotent", func(t *testing.T) {
		repo := factory()
		userID := ids("dup_user")
		grant := seedGrant(t, repo, userID, model.GrantSourceRegisterBonus, 100, epoch.Add(31*24*time.Hour), ids("dup_grant"))
		jobID := ids("dup_job")

		first := reserve(t, repo, userID, jobID, 40, epoch)
		second := reserve(t, repo, userID, jobID, 40, epoch)
		if !second.Duplicate {
			t.Fatal("second reserve should report Duplicate")
		}
		if first.Consumption.ID != second.Consumption.ID {
			t.Fatalf("duplicate returned different consumption %s vs %s", first.Consumption.ID, second.Consumption.ID)
		}
		grantAfter, _ := repo.GetGrantByID(grant.ID)
		if grantAfter.AmountFrozen != 40 {
			t.Fatalf("frozen = %d, want 40 (no double freeze)", grantAfter.AmountFrozen)
		}
	})

	t.Run("SettleChargesFromSnapshotAndIsIdempotent", func(t *testing.T) {
		repo := factory()
		userID := ids("settle_user")
		grant := seedGrant(t, repo, userID, model.GrantSourceMemberMonthly, 100, epoch.Add(31*24*time.Hour), ids("settle_grant"))
		recharge(t, repo, userID, 100, ids("settle_recharge"))
		jobID := ids("settle_job")
		reserve(t, repo, userID, jobID, 140, epoch) // 100 grant + 40 permanent

		settled, err := repo.Settle(jobID, epoch.Add(time.Hour))
		if err != nil || !settled.Changed {
			t.Fatalf("settle changed=%v err=%v", settled.Changed, err)
		}
		grantAfter, _ := repo.GetGrantByID(grant.ID)
		if grantAfter.AmountRemaining != 0 || grantAfter.AmountFrozen != 0 || grantAfter.Status != model.GrantStatusExhausted {
			t.Fatalf("grant = %+v, want remaining 0 frozen 0 exhausted", grantAfter)
		}
		account, _ := repo.GetAccount(userID)
		if account.PermanentBalance != 60 || account.PermanentFrozen != 0 {
			t.Fatalf("account = %+v, want balance 60 frozen 0", account)
		}

		entries, total, err := repo.ListLedger(userID, model.LedgerTypeConsume, 1, 50)
		if err != nil || total != 2 {
			t.Fatalf("consume ledger entries = %d, want 2 (grant + permanent)", total)
		}
		for _, entry := range entries {
			switch entry.Bucket {
			case model.CreditBucketGrant:
				if entry.Amount != -100 || entry.GrantRemainingAfter != 0 {
					t.Fatalf("grant entry = %+v", entry)
				}
			case model.CreditBucketPermanent:
				if entry.Amount != -40 || entry.PermanentAfter != 60 {
					t.Fatalf("permanent entry = %+v", entry)
				}
			}
		}

		again, err := repo.Settle(jobID, epoch.Add(2*time.Hour))
		if err != nil || again.Changed {
			t.Fatalf("repeat settle changed=%v err=%v, want idempotent no-op", again.Changed, err)
		}
		accountAfter, _ := repo.GetAccount(userID)
		if accountAfter.PermanentBalance != 60 {
			t.Fatalf("balance moved on repeat settle: %d", accountAfter.PermanentBalance)
		}
	})

	t.Run("ReleaseReturnsFreezeWithoutLedger", func(t *testing.T) {
		repo := factory()
		userID := ids("release_user")
		grant := seedGrant(t, repo, userID, model.GrantSourceRegisterBonus, 100, epoch.Add(31*24*time.Hour), ids("release_grant"))
		jobID := ids("release_job")
		reserve(t, repo, userID, jobID, 60, epoch)

		released, err := repo.Release(jobID, epoch.Add(time.Minute))
		if err != nil || !released.Changed {
			t.Fatalf("release changed=%v err=%v", released.Changed, err)
		}
		grantAfter, _ := repo.GetGrantByID(grant.ID)
		if grantAfter.AmountFrozen != 0 || grantAfter.AmountRemaining != 100 {
			t.Fatalf("grant = %+v, want frozen 0 remaining 100", grantAfter)
		}
		_, total, _ := repo.ListLedger(userID, model.LedgerTypeConsume, 1, 50)
		if total != 0 {
			t.Fatalf("consume ledger entries = %d, want 0 (失败/取消不扣费)", total)
		}

		again, err := repo.Release(jobID, epoch.Add(2*time.Minute))
		if err != nil || again.Changed {
			t.Fatalf("repeat release changed=%v err=%v, want idempotent no-op", again.Changed, err)
		}
	})

	t.Run("ExpireGrantKeepsFrozenForInFlightTask", func(t *testing.T) {
		repo := factory()
		userID := ids("expiry_user")
		grant := seedGrant(t, repo, userID, model.GrantSourceMemberMonthly, 100, epoch.Add(24*time.Hour), ids("expiry_grant"))
		jobID := ids("expiry_job")
		reserve(t, repo, userID, jobID, 30, epoch)

		afterExpiry := epoch.Add(25 * time.Hour)
		expired, err := repo.ExpireGrant(grant.ID, afterExpiry)
		if err != nil || expired.Deducted != 70 {
			t.Fatalf("expire deducted=%d err=%v, want 70", expired.Deducted, err)
		}
		grantAfter, _ := repo.GetGrantByID(grant.ID)
		if grantAfter.AmountRemaining != 30 || grantAfter.AmountFrozen != 30 {
			t.Fatalf("grant = %+v, want remaining 30 frozen 30 (冻结不清)", grantAfter)
		}

		// 重复过期不得再扣。
		again, err := repo.ExpireGrant(grant.ID, afterExpiry)
		if err != nil || again.Deducted != 0 {
			t.Fatalf("repeat expire deducted=%d err=%v, want 0", again.Deducted, err)
		}

		// 在途任务按冻结快照正常结算。
		if _, err := repo.Settle(jobID, afterExpiry.Add(time.Minute)); err != nil {
			t.Fatalf("settle after expiry: %v", err)
		}
		grantFinal, _ := repo.GetGrantByID(grant.ID)
		if grantFinal.AmountRemaining != 0 || grantFinal.Status != model.GrantStatusExhausted {
			t.Fatalf("grant = %+v, want remaining 0 exhausted", grantFinal)
		}
	})

	t.Run("ExpireGrantFullyUnused", func(t *testing.T) {
		repo := factory()
		userID := ids("full_expiry_user")
		grant := seedGrant(t, repo, userID, model.GrantSourceActivity, 80, epoch.Add(24*time.Hour), ids("full_expiry_grant"))

		expired, err := repo.ExpireGrant(grant.ID, epoch.Add(25*time.Hour))
		if err != nil || expired.Deducted != 80 {
			t.Fatalf("expire deducted=%d err=%v, want 80", expired.Deducted, err)
		}
		grantAfter, _ := repo.GetGrantByID(grant.ID)
		if grantAfter.Status != model.GrantStatusExpired {
			t.Fatalf("status = %s, want expired", grantAfter.Status)
		}
		again, _ := repo.ExpireGrant(grant.ID, epoch.Add(26*time.Hour))
		if !again.AlreadyExpired {
			t.Fatal("repeat expire on terminal grant should report AlreadyExpired")
		}
	})

	t.Run("AdjustPermanentNonceIdempotent", func(t *testing.T) {
		repo := factory()
		userID := ids("adjust_user")
		nonce := ids("adjust_nonce")

		first, err := repo.AdjustPermanent(userID, 5000, model.LedgerTypeAdminAdd, "admin:ops", nonce, epoch)
		if err != nil || !first.Applied || first.Account.PermanentBalance != 5000 {
			t.Fatalf("first adjust = %+v err=%v", first, err)
		}
		second, err := repo.AdjustPermanent(userID, 5000, model.LedgerTypeAdminAdd, "admin:ops", nonce, epoch.Add(time.Minute))
		if err != nil || second.Applied || second.Account.PermanentBalance != 5000 {
			t.Fatalf("second adjust = %+v err=%v, want applied=false balance unchanged", second, err)
		}
	})

	t.Run("RefundDeductionAllowsNegativeAndIsIdempotent", func(t *testing.T) {
		repo := factory()
		userID := ids("refund_user")
		recharge(t, repo, userID, 100, ids("refund_recharge"))

		applied, err := repo.DeductPermanentForRefund(userID, 150, ids("refund_order"), epoch)
		if err != nil || !applied {
			t.Fatalf("refund applied=%v err=%v", applied, err)
		}
		account, _ := repo.GetAccount(userID)
		if account.PermanentBalance != -50 {
			t.Fatalf("balance = %d, want -50", account.PermanentBalance)
		}

		// 负余额期间可用量为零，reserve 必须失败。
		_, err = repo.Reserve(ReserveInput{JobID: ids("refund_job"), UserID: userID, TaskType: model.TaskTypeImage, Model: "m", Credits: 1, Now: epoch})
		if !errors.Is(err, ErrInsufficientCredits) {
			t.Fatalf("reserve with negative balance err = %v, want ErrInsufficientCredits", err)
		}

		again, err := repo.DeductPermanentForRefund(userID, 150, ids("refund_order"), epoch)
		if err != nil || again {
			t.Fatalf("repeat refund applied=%v err=%v, want idempotent", again, err)
		}

		// 后续充值冲抵。
		recharge(t, repo, userID, 500, ids("refund_recover"))
		account, _ = repo.GetAccount(userID)
		if account.PermanentBalance != 450 {
			t.Fatalf("balance after recovery = %d, want 450", account.PermanentBalance)
		}
	})

	t.Run("ConcurrentReserveNeverOverspends", func(t *testing.T) {
		repo := factory()
		userID := ids("race_user")
		seedGrant(t, repo, userID, model.GrantSourceMemberMonthly, 100, epoch.Add(31*24*time.Hour), ids("race_grant"))

		const workers = 16
		var wg sync.WaitGroup
		results := make(chan error, workers)
		for i := 0; i < workers; i++ {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()
				_, err := repo.Reserve(ReserveInput{
					JobID: ids(fmt.Sprintf("race_job_%d", index)), UserID: userID,
					TaskType: model.TaskTypeImage, Model: "m", Credits: 30, Now: epoch,
				})
				results <- err
			}(i)
		}
		wg.Wait()
		close(results)

		succeeded := 0
		for err := range results {
			if err == nil {
				succeeded++
				continue
			}
			if !errors.Is(err, ErrInsufficientCredits) {
				t.Fatalf("unexpected error: %v", err)
			}
		}
		if succeeded != 3 { // 100 / 30 = 3 笔成功，其余余额不足
			t.Fatalf("succeeded = %d, want 3", succeeded)
		}
		grants, err := repo.ListGrantsByUser(userID)
		if err != nil || len(grants) != 1 {
			t.Fatalf("grants = %+v err=%v", grants, err)
		}
		if grants[0].AmountFrozen != 90 || grants[0].AmountRemaining != 100 {
			t.Fatalf("grant = %+v, want frozen 90 remaining 100 (不超扣)", grants[0])
		}
	})
}
