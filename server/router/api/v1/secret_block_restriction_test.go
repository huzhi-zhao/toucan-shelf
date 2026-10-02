package v1

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func mustPolicy(t *testing.T, preset, tz string) *secretBlockPolicy {
	t.Helper()
	p, err := newSecretBlockPolicy(preset, tz, "", "ok")
	require.NoError(t, err)
	return p
}

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	require.NoError(t, err)
	return loc
}

func TestSecretPolicyAvailableAt(t *testing.T) {
	t.Parallel()
	sh := mustLocation(t, "Asia/Shanghai")
	at := func(y int, m time.Month, d, hh, mm, ss int) time.Time { return time.Date(y, m, d, hh, mm, ss, 0, sh) }

	high := mustPolicy(t, secretPresetHighImpact, "Asia/Shanghai")
	low := mustPolicy(t, secretPresetLowImpact, "Asia/Shanghai")

	cases := []struct {
		name   string
		policy *secretBlockPolicy
		now    time.Time
		want   time.Time
	}{
		{"high: midnight waits for this morning", high, at(2026, 10, 3, 0, 30, 0), at(2026, 10, 3, 8, 0, 0)},
		{"high: evening waits for next morning", high, at(2026, 10, 2, 20, 0, 0), at(2026, 10, 3, 8, 0, 0)},
		{"high: 07:59 opens at 08:00 (accepted trade-off)", high, at(2026, 10, 3, 7, 59, 0), at(2026, 10, 3, 8, 0, 0)},
		{"high: 08:00 sharp is working hours", high, at(2026, 10, 3, 8, 0, 0), at(2026, 10, 3, 8, 30, 0)},
		{"high: mid-day waits 30 minutes", high, at(2026, 10, 3, 14, 10, 5), at(2026, 10, 3, 14, 40, 5)},
		{"high: 17:59 still working hours, may run past 18:00", high, at(2026, 10, 3, 17, 59, 0), at(2026, 10, 3, 18, 29, 0)},
		{"high: 18:00 sharp is after hours", high, at(2026, 10, 3, 18, 0, 0), at(2026, 10, 4, 8, 0, 0)},
		{"low: daytime still waits for next morning", low, at(2026, 10, 3, 10, 0, 0), at(2026, 10, 4, 8, 0, 0)},
		{"low: 08:00 sharp waits a full day", low, at(2026, 10, 3, 8, 0, 0), at(2026, 10, 4, 8, 0, 0)},
		{"low: midnight waits for this morning", low, at(2026, 10, 3, 0, 1, 0), at(2026, 10, 3, 8, 0, 0)},
		{"month rollover", low, at(2026, 10, 31, 22, 0, 0), at(2026, 11, 1, 8, 0, 0)},
	}
	for _, c := range cases {
		got, err := c.policy.availableAt(c.now)
		require.NoError(t, err, c.name)
		require.True(t, c.want.Equal(got), "%s: want %s, got %s", c.name, c.want, got.In(sh))
	}
}

// The process zone must not matter: a container usually runs in UTC, and reading
// the hours there would turn 08:00 Shanghai into 16:00.
func TestSecretPolicyAvailableAtIgnoresProcessZone(t *testing.T) {
	t.Parallel()
	high := mustPolicy(t, secretPresetHighImpact, "Asia/Shanghai")
	// 23:00 Shanghai, expressed in UTC (15:00Z) as a UTC server would see it.
	now := time.Date(2026, 10, 2, 15, 0, 0, 0, time.UTC)
	got, err := high.availableAt(now)
	require.NoError(t, err)
	require.Equal(t, time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC), got.UTC(), "08:00 Shanghai is 00:00Z")
}

func TestSecretPolicyAvailableAtAcrossDST(t *testing.T) {
	t.Parallel()
	ny := mustLocation(t, "America/New_York")
	low := mustPolicy(t, secretPresetLowImpact, "America/New_York")
	// US DST ends 2026-11-01 at 02:00. A request the evening before must still
	// open at 08:00 wall-clock, which is 25 hours later, not 24.
	now := time.Date(2026, 10, 31, 8, 0, 0, 0, ny)
	got, err := low.availableAt(now)
	require.NoError(t, err)
	require.Equal(t, 8, got.In(ny).Hour())
	require.Equal(t, 1, got.In(ny).Day())
	require.Equal(t, 25*time.Hour, got.Sub(now))
}

func TestNewSecretBlockPolicyPresets(t *testing.T) {
	t.Parallel()
	high := mustPolicy(t, secretPresetHighImpact, "UTC")
	require.Equal(t, 8*60, high.WorkStartMinute)
	require.Equal(t, 18*60, high.WorkEndMinute)
	require.Equal(t, int64(30*60), high.WorkDelaySeconds)
	require.Equal(t, 1, high.EmergencyQuota)
	require.Equal(t, 30, high.EmergencyWindowDays)

	low := mustPolicy(t, secretPresetLowImpact, "UTC")
	require.Zero(t, low.WorkDelaySeconds)
	require.Zero(t, low.EmergencyQuota)
	require.Equal(t, int64(10*60), low.ViewSeconds)

	_, err := newSecretBlockPolicy("medium", "UTC", "", "ok")
	require.Error(t, err)
}

func TestSecretBlockPolicyFromRequest(t *testing.T) {
	t.Parallel()
	p, err := secretBlockPolicyFromRequest(&v1pb.SecretBlockPolicy{
		Preset:      v1pb.SecretBlockPolicy_HIGH_IMPACT,
		TimeZone:    "Asia/Shanghai",
		ConfirmText: "  我已想清楚，\n  明早再处理  ",
		// Numbers in the request are ignored: the preset decides.
		WorkDelaySeconds: 1,
		EmergencyQuota:   99,
	})
	require.NoError(t, err)
	require.Equal(t, "我已想清楚， 明早再处理", p.ConfirmText)
	require.Equal(t, int64(30*60), p.WorkDelaySeconds)
	require.Equal(t, 1, p.EmergencyQuota)

	for name, in := range map[string]*v1pb.SecretBlockPolicy{
		"no preset":     {TimeZone: "UTC", ConfirmText: "ok"},
		"no zone":       {Preset: v1pb.SecretBlockPolicy_LOW_IMPACT, ConfirmText: "ok"},
		"bad zone":      {Preset: v1pb.SecretBlockPolicy_LOW_IMPACT, TimeZone: "Mars/Olympus", ConfirmText: "ok"},
		"blank confirm": {Preset: v1pb.SecretBlockPolicy_LOW_IMPACT, TimeZone: "UTC", ConfirmText: "   "},
	} {
		_, err := secretBlockPolicyFromRequest(in)
		require.Error(t, err, name)
	}
}

func TestSecretUnlockState(t *testing.T) {
	t.Parallel()
	p := mustPolicy(t, secretPresetLowImpact, "UTC")
	const requested, available = int64(1000), int64(5000)
	pending := &store.SecretBlockUnlock{RequestedTs: requested, AvailableTs: available}

	state, _ := secretUnlockState(nil, p, available)
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, state)

	state, _ = secretUnlockState(pending, p, available-1)
	require.Equal(t, v1pb.SecretBlockRestriction_PENDING, state)

	state, expire := secretUnlockState(pending, p, available)
	require.Equal(t, v1pb.SecretBlockRestriction_READY, state)
	require.Equal(t, available+p.ReadyTTLSeconds, expire)

	// An unviewed request lapses after the ready TTL.
	state, _ = secretUnlockState(pending, p, available+p.ReadyTTLSeconds)
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, state)

	opened := &store.SecretBlockUnlock{RequestedTs: requested, AvailableTs: available, OpenedTs: 6000, ExpiresTs: 6600}
	state, expire = secretUnlockState(opened, p, 6599)
	require.Equal(t, v1pb.SecretBlockRestriction_OPEN, state)
	require.Equal(t, int64(6600), expire)
	state, _ = secretUnlockState(opened, p, 6600)
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, state)

	canceled := &store.SecretBlockUnlock{RequestedTs: requested, AvailableTs: available, CanceledTs: 2000}
	state, _ = secretUnlockState(canceled, p, available)
	require.Equal(t, v1pb.SecretBlockRestriction_LOCKED, state)
}

func TestNormalizeTypedText(t *testing.T) {
	t.Parallel()
	require.Equal(t, "a b c", normalizeTypedText("  a \t b\n\nc  "))
	require.Equal(t, "Exact, Case.", normalizeTypedText("Exact, Case."))
	require.NotEqual(t, normalizeTypedText("exact, case."), normalizeTypedText("Exact, Case."))
}
