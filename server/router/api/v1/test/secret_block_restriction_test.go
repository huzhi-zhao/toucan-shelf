package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// The emergency statement accepted for a zh-Hans UI. Must match the server list.
const emergencyStatementZH = "我确认这件事现在必须处理，不能等到明天"

type restrictedFixture struct {
	t    *testing.T
	ts   *TestService
	ctx  context.Context
	now  time.Time
	loc  *time.Location
	name string
}

// newRestrictedFixture creates a user, sets the clock to the given Shanghai wall
// time, and creates one secret block restricted with the given preset.
func newRestrictedFixture(t *testing.T, preset v1pb.SecretBlockPolicy_Preset, hh, mm int) *restrictedFixture {
	t.Helper()
	ts := NewTestService(t)
	t.Cleanup(ts.Cleanup)
	loc, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)

	f := &restrictedFixture{t: t, ts: ts, loc: loc, now: time.Date(2026, 10, 2, hh, mm, 0, 0, loc)}
	ts.Service.Clock = func() time.Time { return f.now }

	user, err := ts.CreateRegularUser(context.Background(), "owner")
	require.NoError(t, err)
	f.ctx = ts.CreateUserContext(context.Background(), user.ID)

	created, err := ts.Service.CreateSecretBlock(f.ctx, &v1pb.CreateSecretBlockRequest{
		SecretBlock: &v1pb.SecretBlock{Hint: "Mac admin", Envelope: testEnvelope("first")},
		Policy: &v1pb.SecretBlockPolicy{
			Preset:      preset,
			TimeZone:    "Asia/Shanghai",
			Prompt:      "真的必须现在吗？",
			ConfirmText: "我已想清楚",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, created.Restriction)
	f.name = created.Name
	return f
}

func testEnvelope(ciphertext string) *v1pb.SecretEnvelope {
	return &v1pb.SecretEnvelope{
		Kdf:        "master-v1",
		Cipher:     "aes-256-gcm",
		Salt:       "c2FsdA==",
		Nonce:      "bm9uY2U=",
		Verifier:   "dmVyaWZpZXI=",
		Ciphertext: ciphertext,
	}
}

func (f *restrictedFixture) at(day, hh, mm int) {
	f.now = time.Date(2026, 10, day, hh, mm, 0, 0, f.loc)
}

func (f *restrictedFixture) advance(d time.Duration) { f.now = f.now.Add(d) }

func (f *restrictedFixture) get() (*v1pb.SecretBlock, error) {
	return f.ts.Service.GetSecretBlock(f.ctx, &v1pb.GetSecretBlockRequest{Name: f.name})
}

func (f *restrictedFixture) summary() *v1pb.SecretBlockSummary {
	f.t.Helper()
	s, err := f.ts.Service.GetSecretBlockSummary(f.ctx, &v1pb.GetSecretBlockSummaryRequest{Name: f.name})
	require.NoError(f.t, err)
	return s
}

func (f *restrictedFixture) request() (*v1pb.SecretBlockSummary, error) {
	return f.ts.Service.RequestSecretBlockUnlock(f.ctx, &v1pb.RequestSecretBlockUnlockRequest{Name: f.name, ConfirmText: "我已想清楚"})
}

func (f *restrictedFixture) emergency(reason string) (*v1pb.SecretBlockSummary, error) {
	return f.ts.Service.RequestSecretBlockUnlock(f.ctx, &v1pb.RequestSecretBlockUnlockRequest{
		Name:            f.name,
		ConfirmText:     "我已想清楚",
		Emergency:       true,
		EmergencyText:   emergencyStatementZH,
		EmergencyReason: reason,
	})
}

func requireCode(t *testing.T, err error, code codes.Code) {
	t.Helper()
	require.Error(t, err)
	require.Equal(t, code, status.Code(err), err.Error())
}

func TestRestrictedSecretBlockNightRequestWaitsForMorning(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, 0, 30)

	// Restricted and not requested: the envelope is not served.
	_, err := f.get()
	requireCode(t, err, codes.FailedPrecondition)
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, f.summary().Restriction.UnlockState)

	// The confirmation must match.
	_, err = f.ts.Service.RequestSecretBlockUnlock(f.ctx, &v1pb.RequestSecretBlockUnlockRequest{Name: f.name, ConfirmText: "我想清楚了"})
	requireCode(t, err, codes.InvalidArgument)

	s, err := f.request()
	require.NoError(t, err)
	require.Equal(t, v1pb.SecretBlockRestriction_PENDING, s.Restriction.UnlockState)
	require.Equal(t, time.Date(2026, 10, 2, 8, 0, 0, 0, f.loc).Unix(), s.Restriction.AvailableTime.AsTime().Unix())

	// A second request does not stack.
	_, err = f.request()
	requireCode(t, err, codes.FailedPrecondition)

	// Still waiting at 07:59.
	f.at(2, 7, 59)
	_, err = f.get()
	requireCode(t, err, codes.FailedPrecondition)

	// Ready at 08:00, and asking for the summary does not start the window.
	f.at(2, 8, 0)
	require.Equal(t, v1pb.SecretBlockRestriction_READY, f.summary().Restriction.UnlockState)

	// Fetched at 09:00: the window starts now, not at 08:00.
	f.at(2, 9, 0)
	got, err := f.get()
	require.NoError(t, err)
	require.Equal(t, "first", got.Envelope.Ciphertext)
	require.Equal(t, v1pb.SecretBlockRestriction_OPEN, got.Restriction.UnlockState)
	require.Equal(t, time.Date(2026, 10, 2, 9, 10, 0, 0, f.loc).Unix(), got.Restriction.ExpireTime.AsTime().Unix())

	// Re-fetching inside the window works and does not extend it.
	f.advance(9 * time.Minute)
	got, err = f.get()
	require.NoError(t, err)
	require.Equal(t, time.Date(2026, 10, 2, 9, 10, 0, 0, f.loc).Unix(), got.Restriction.ExpireTime.AsTime().Unix())

	// Window over: back to locked, a new request is needed.
	f.advance(time.Minute)
	_, err = f.get()
	requireCode(t, err, codes.FailedPrecondition)
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, f.summary().Restriction.UnlockState)
}

func TestRestrictedSecretBlockWorkingHours(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, 14, 0)
	s, err := f.request()
	require.NoError(t, err)
	require.Equal(t, f.now.Add(30*time.Minute).Unix(), s.Restriction.AvailableTime.AsTime().Unix())

	f.advance(29 * time.Minute)
	_, err = f.get()
	requireCode(t, err, codes.FailedPrecondition)
	f.advance(time.Minute)
	_, err = f.get()
	require.NoError(t, err)
}

func TestRestrictedSecretBlockLowImpactWaitsEvenInDaytime(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_LOW_IMPACT, 10, 0)
	s, err := f.request()
	require.NoError(t, err)
	require.Equal(t, time.Date(2026, 10, 3, 8, 0, 0, 0, f.loc).Unix(), s.Restriction.AvailableTime.AsTime().Unix())

	// Low impact has no emergency path.
	_, err = f.emergency("服务器挂了需要马上登录处理")
	requireCode(t, err, codes.FailedPrecondition)
}

func TestRestrictedSecretBlockReadyLapses(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, 14, 0)
	_, err := f.request()
	require.NoError(t, err)
	f.advance(30*time.Minute + 24*time.Hour)
	_, err = f.get()
	requireCode(t, err, codes.FailedPrecondition)
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, f.summary().Restriction.UnlockState)
}

func TestRestrictedSecretBlockCancel(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, 23, 0)
	_, err := f.ts.Service.CancelSecretBlockUnlock(f.ctx, &v1pb.CancelSecretBlockUnlockRequest{Name: f.name})
	requireCode(t, err, codes.FailedPrecondition)

	_, err = f.request()
	require.NoError(t, err)
	s, err := f.ts.Service.CancelSecretBlockUnlock(f.ctx, &v1pb.CancelSecretBlockUnlockRequest{Name: f.name})
	require.NoError(t, err)
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, s.Restriction.UnlockState)

	// Canceled stays canceled once the original time comes.
	f.at(3, 8, 0)
	_, err = f.get()
	requireCode(t, err, codes.FailedPrecondition)
}

// The emergency path is switched off for now (secretEmergencyUnlockEnabled in
// secret_block_restriction.go): even a high-impact block, typed correctly at
// night, must wait for the morning, and the summary offers no emergency.
func TestRestrictedSecretBlockEmergencyDisabled(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, 23, 40)
	require.Zero(t, f.summary().Restriction.EmergencyRemaining)

	_, err := f.emergency("线上服务挂了需要管理员权限重启")
	requireCode(t, err, codes.FailedPrecondition)

	// Nothing was recorded and no wait was skipped.
	s := f.summary()
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, s.Restriction.UnlockState)
	require.Nil(t, s.Restriction.LastEmergencyTime)
	require.Nil(t, s.Restriction.NextEmergencyTime)
	_, err = f.get()
	requireCode(t, err, codes.FailedPrecondition)
}

func TestRestrictedSecretBlockPolicyChangesWait(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, 23, 0)

	// Lifting the restriction at night is scheduled for the morning.
	s, err := f.ts.Service.UpdateSecretBlockPolicy(f.ctx, &v1pb.UpdateSecretBlockPolicyRequest{Name: f.name})
	require.NoError(t, err)
	require.NotNil(t, s.Restriction, "still restricted until the change takes effect")
	require.NotNil(t, s.Restriction.PendingChange)
	require.Nil(t, s.Restriction.PendingChange.Policy)
	require.Equal(t, time.Date(2026, 10, 3, 8, 0, 0, 0, f.loc).Unix(), s.Restriction.PendingChange.EffectiveTime.AsTime().Unix())

	_, err = f.get()
	requireCode(t, err, codes.FailedPrecondition)

	// Deleting is not a way around it either.
	_, err = f.ts.Service.DeleteSecretBlock(f.ctx, &v1pb.DeleteSecretBlockRequest{Name: f.name})
	requireCode(t, err, codes.FailedPrecondition)

	// Nor is replacing the content: a restricted block is one-shot, since a
	// blind replacement would destroy the only copy of what it held.
	_, err = f.ts.Service.UpdateSecretBlock(f.ctx, &v1pb.UpdateSecretBlockRequest{
		SecretBlock: &v1pb.SecretBlock{Name: f.name, Hint: "Mac admin", Envelope: testEnvelope("second")},
	})
	requireCode(t, err, codes.FailedPrecondition)

	// At 08:00 the change applies: unrestricted, served with the original
	// content, and from then on an ordinary block that can be edited and deleted.
	f.at(3, 8, 0)
	got, err := f.get()
	require.NoError(t, err)
	require.Nil(t, got.Restriction)
	require.Equal(t, "first", got.Envelope.Ciphertext)
	updated, err := f.ts.Service.UpdateSecretBlock(f.ctx, &v1pb.UpdateSecretBlockRequest{
		SecretBlock: &v1pb.SecretBlock{Name: f.name, Hint: "Mac admin", Envelope: testEnvelope("second")},
	})
	require.NoError(t, err)
	require.Equal(t, "second", updated.Envelope.Ciphertext)
	_, err = f.ts.Service.DeleteSecretBlock(f.ctx, &v1pb.DeleteSecretBlockRequest{Name: f.name})
	require.NoError(t, err)
}

func TestRestrictedSecretBlockPolicyChangeCanBeCanceled(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, 23, 0)
	_, err := f.ts.Service.UpdateSecretBlockPolicy(f.ctx, &v1pb.UpdateSecretBlockPolicyRequest{
		Name:   f.name,
		Policy: &v1pb.SecretBlockPolicy{Preset: v1pb.SecretBlockPolicy_LOW_IMPACT, TimeZone: "Asia/Shanghai", ConfirmText: "新的确认"},
	})
	require.NoError(t, err)
	s, err := f.ts.Service.CancelSecretBlockPolicyChange(f.ctx, &v1pb.CancelSecretBlockPolicyChangeRequest{Name: f.name})
	require.NoError(t, err)
	require.Nil(t, s.Restriction.PendingChange)

	f.at(3, 9, 0)
	s = f.summary()
	require.Equal(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, s.Restriction.Policy.Preset, "canceled change never applies")
}

func TestRestrictingOrdinaryBlockIsImmediate(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	user, err := ts.CreateRegularUser(context.Background(), "owner")
	require.NoError(t, err)
	ctx := ts.CreateUserContext(context.Background(), user.ID)

	created, err := ts.Service.CreateSecretBlock(ctx, &v1pb.CreateSecretBlockRequest{
		SecretBlock: &v1pb.SecretBlock{Hint: "plain", Envelope: testEnvelope("x")},
	})
	require.NoError(t, err)
	require.Nil(t, created.Restriction)

	s, err := ts.Service.UpdateSecretBlockPolicy(ctx, &v1pb.UpdateSecretBlockPolicyRequest{
		Name:   created.Name,
		Policy: &v1pb.SecretBlockPolicy{Preset: v1pb.SecretBlockPolicy_LOW_IMPACT, TimeZone: "UTC", ConfirmText: "ok"},
	})
	require.NoError(t, err)
	require.NotNil(t, s.Restriction)
	require.Nil(t, s.Restriction.PendingChange)
	_, err = ts.Service.GetSecretBlock(ctx, &v1pb.GetSecretBlockRequest{Name: created.Name})
	requireCode(t, err, codes.FailedPrecondition)

	// Listing reports the restriction without ever carrying ciphertext.
	list, err := ts.Service.ListSecretBlocks(ctx, &v1pb.ListSecretBlocksRequest{})
	require.NoError(t, err)
	require.Len(t, list.SecretBlocks, 1)
	require.NotNil(t, list.SecretBlocks[0].Restriction)
}

func TestRestrictedSecretBlockIsOwnerOnly(t *testing.T) {
	f := newRestrictedFixture(t, v1pb.SecretBlockPolicy_HIGH_IMPACT, 14, 0)
	other, err := f.ts.CreateRegularUser(context.Background(), "other")
	require.NoError(t, err)
	otherCtx := f.ts.CreateUserContext(context.Background(), other.ID)

	_, err = f.ts.Service.RequestSecretBlockUnlock(otherCtx, &v1pb.RequestSecretBlockUnlockRequest{Name: f.name, ConfirmText: "我已想清楚"})
	requireCode(t, err, codes.NotFound)
	_, err = f.ts.Service.GetSecretBlockSummary(otherCtx, &v1pb.GetSecretBlockSummaryRequest{Name: f.name})
	requireCode(t, err, codes.NotFound)
	_, err = f.ts.Service.UpdateSecretBlockPolicy(otherCtx, &v1pb.UpdateSecretBlockPolicyRequest{Name: f.name})
	requireCode(t, err, codes.NotFound)

	_, err = f.ts.Service.GetSecretBlockSummary(context.Background(), &v1pb.GetSecretBlockSummaryRequest{Name: f.name})
	requireCode(t, err, codes.Unauthenticated)
}
