package v1

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

// Restricted secret blocks put a time gate in front of the envelope. The gate
// guards against the owner's own impulses, not against an attacker: it lives on
// the server so that skipping it costs more than waiting, which is all it is for.
// The server still never touches plaintext or key material — it only decides
// whether to hand out the opaque envelope right now.
//
// See docs/dev/requirements/editor/restricted-secret-block.md.

const (
	secretPresetLowImpact  = "low_impact"
	secretPresetHighImpact = "high_impact"

	secretMaxPromptLength          = 1000
	secretMaxConfirmTextLength     = 200
	secretMaxEmergencyReasonLength = 500
	secretMinEmergencyReasonRunes  = 10
)

// secretEmergencyStatements are the fixed sentences an emergency unlock must be
// typed with, one per UI language. Mirrored in web/src/utils/secret-restriction.ts.
var secretEmergencyStatements = []string{
	"我确认这件事现在必须处理，不能等到明天",
	"I confirm this cannot wait until tomorrow",
}

// secretBlockPolicy is the stored form of a restricted block's policy.
//
// Every number is persisted rather than looked up from the preset at read time,
// so retuning a preset later never silently loosens a block that already exists.
type secretBlockPolicy struct {
	Preset              string `json:"preset"`
	TimeZone            string `json:"timeZone"`
	Prompt              string `json:"prompt"`
	ConfirmText         string `json:"confirmText"`
	WorkStartMinute     int    `json:"workStartMinute"`
	WorkEndMinute       int    `json:"workEndMinute"`
	WorkDelaySeconds    int64  `json:"workDelaySeconds"`
	ReleaseMinute       int    `json:"releaseMinute"`
	EmergencyQuota      int    `json:"emergencyQuota"`
	EmergencyWindowDays int    `json:"emergencyWindowDays"`
	ViewSeconds         int64  `json:"viewSeconds"`
	ReadyTTLSeconds     int64  `json:"readyTtlSeconds"`
}

// newSecretBlockPolicy fills a policy's numbers from its preset.
func newSecretBlockPolicy(preset, timeZone, prompt, confirmText string) (*secretBlockPolicy, error) {
	p := &secretBlockPolicy{
		Preset:          preset,
		TimeZone:        timeZone,
		Prompt:          prompt,
		ConfirmText:     confirmText,
		ReleaseMinute:   8 * 60,
		ViewSeconds:     10 * 60,
		ReadyTTLSeconds: 24 * 60 * 60,
	}
	switch preset {
	case secretPresetLowImpact:
		// Always wait for the next morning; no way around it.
	case secretPresetHighImpact:
		// Losing this key can stop work, so working hours get a short wait and
		// there is a rate-limited emergency path for the rest of the day.
		p.WorkStartMinute = 8 * 60
		p.WorkEndMinute = 18 * 60
		p.WorkDelaySeconds = 30 * 60
		p.EmergencyQuota = 1
		p.EmergencyWindowDays = 30
	default:
		return nil, errors.Errorf("unknown preset %q", preset)
	}
	return p, nil
}

func (p *secretBlockPolicy) location() (*time.Location, error) {
	loc, err := time.LoadLocation(p.TimeZone)
	if err != nil {
		return nil, errors.Wrapf(err, "load time zone %q", p.TimeZone)
	}
	return loc, nil
}

// availableAt is when a normal request made at now opens. Inside working hours
// it is a fixed wait; otherwise it is the first release time strictly after now,
// read on the policy's own wall clock.
func (p *secretBlockPolicy) availableAt(now time.Time) (time.Time, error) {
	loc, err := p.location()
	if err != nil {
		return time.Time{}, err
	}
	local := now.In(loc)
	minute := local.Hour()*60 + local.Minute()
	if p.WorkDelaySeconds > 0 && p.WorkStartMinute < p.WorkEndMinute && minute >= p.WorkStartMinute && minute < p.WorkEndMinute {
		return now.Add(time.Duration(p.WorkDelaySeconds) * time.Second), nil
	}
	y, m, d := local.Date()
	release := time.Date(y, m, d, p.ReleaseMinute/60, p.ReleaseMinute%60, 0, 0, loc)
	if !release.After(local) {
		// time.Date normalizes d+1, and recomputing (rather than adding 24h)
		// keeps the release on the wall-clock hour across DST changes.
		release = time.Date(y, m, d+1, p.ReleaseMinute/60, p.ReleaseMinute%60, 0, 0, loc)
	}
	return release, nil
}

func (p *secretBlockPolicy) emergencyWindow() time.Duration {
	return time.Duration(p.EmergencyWindowDays) * 24 * time.Hour
}

func parseSecretBlockPolicy(raw string) (*secretBlockPolicy, error) {
	if raw == "" {
		return nil, nil
	}
	p := &secretBlockPolicy{}
	if err := json.Unmarshal([]byte(raw), p); err != nil {
		return nil, errors.Wrap(err, "parse secret block policy")
	}
	return p, nil
}

func marshalSecretBlockPolicy(p *secretBlockPolicy) (string, error) {
	if p == nil {
		return "", nil
	}
	b, err := json.Marshal(p)
	if err != nil {
		return "", errors.Wrap(err, "marshal secret block policy")
	}
	return string(b), nil
}

// normalizeTypedText is how typed confirmations are compared: surrounding
// whitespace trimmed and inner runs collapsed, everything else exact.
func normalizeTypedText(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// secretBlockPolicyFromRequest validates a client-supplied policy. Only the
// preset, time zone and the two texts are read; the numbers come from the preset.
func secretBlockPolicyFromRequest(in *v1pb.SecretBlockPolicy) (*secretBlockPolicy, error) {
	var preset string
	switch in.Preset {
	case v1pb.SecretBlockPolicy_LOW_IMPACT:
		preset = secretPresetLowImpact
	case v1pb.SecretBlockPolicy_HIGH_IMPACT:
		preset = secretPresetHighImpact
	default:
		return nil, status.Errorf(codes.InvalidArgument, "policy preset is required")
	}
	if in.TimeZone == "" {
		return nil, status.Errorf(codes.InvalidArgument, "policy time_zone is required")
	}
	if _, err := time.LoadLocation(in.TimeZone); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "unknown time zone: %s", in.TimeZone)
	}
	confirm := normalizeTypedText(in.ConfirmText)
	if confirm == "" {
		return nil, status.Errorf(codes.InvalidArgument, "policy confirm_text is required")
	}
	if len(confirm) > secretMaxConfirmTextLength {
		return nil, status.Errorf(codes.InvalidArgument, "policy confirm_text is too long")
	}
	prompt := strings.TrimSpace(in.Prompt)
	if len(prompt) > secretMaxPromptLength {
		return nil, status.Errorf(codes.InvalidArgument, "policy prompt is too long")
	}
	p, err := newSecretBlockPolicy(preset, in.TimeZone, prompt, confirm)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}
	return p, nil
}

func convertSecretBlockPolicyToProto(p *secretBlockPolicy) *v1pb.SecretBlockPolicy {
	preset := v1pb.SecretBlockPolicy_PRESET_UNSPECIFIED
	switch p.Preset {
	case secretPresetLowImpact:
		preset = v1pb.SecretBlockPolicy_LOW_IMPACT
	case secretPresetHighImpact:
		preset = v1pb.SecretBlockPolicy_HIGH_IMPACT
	}
	return &v1pb.SecretBlockPolicy{
		Preset:              preset,
		TimeZone:            p.TimeZone,
		Prompt:              p.Prompt,
		ConfirmText:         p.ConfirmText,
		WorkStartMinute:     int32(p.WorkStartMinute),
		WorkEndMinute:       int32(p.WorkEndMinute),
		WorkDelaySeconds:    int32(p.WorkDelaySeconds),
		ReleaseMinute:       int32(p.ReleaseMinute),
		EmergencyQuota:      int32(p.EmergencyQuota),
		EmergencyWindowDays: int32(p.EmergencyWindowDays),
		ViewSeconds:         int32(p.ViewSeconds),
		ReadyTtlSeconds:     int32(p.ReadyTTLSeconds),
	}
}

// secretUnlockState derives where a request stands at now. A nil or withdrawn
// request, an elapsed viewing window and a lapsed unviewed request are all LOCKED.
// The second result is the state's expire time (READY/OPEN), or 0.
func secretUnlockState(u *store.SecretBlockUnlock, p *secretBlockPolicy, now int64) (v1pb.SecretBlockRestriction_UnlockState, int64) {
	if u == nil || u.CanceledTs > 0 {
		return v1pb.SecretBlockRestriction_LOCKED, 0
	}
	if u.OpenedTs > 0 {
		if now < u.ExpiresTs {
			return v1pb.SecretBlockRestriction_OPEN, u.ExpiresTs
		}
		return v1pb.SecretBlockRestriction_LOCKED, 0
	}
	if now < u.AvailableTs {
		return v1pb.SecretBlockRestriction_PENDING, 0
	}
	if readyEnd := u.AvailableTs + p.ReadyTTLSeconds; now < readyEnd {
		return v1pb.SecretBlockRestriction_READY, readyEnd
	}
	return v1pb.SecretBlockRestriction_LOCKED, 0
}

// secretBlockGate is the slice of a secret block the time gate needs. Both
// SecretBlock and SecretBlockSummary provide it.
type secretBlockGate struct {
	ID                       int32
	Policy                   string
	PendingPolicy            string
	PendingPolicyEffectiveTs int64
}

func (s *APIV1Service) now() time.Time {
	if s.Clock != nil {
		return s.Clock()
	}
	return time.Now()
}

// settleSecretBlockGate applies a scheduled policy change whose time has come.
// Changes are applied lazily on read, so no background job is involved; the
// gate fields are updated in place.
func (s *APIV1Service) settleSecretBlockGate(ctx context.Context, g *secretBlockGate) error {
	if g.PendingPolicyEffectiveTs == 0 || s.now().Unix() < g.PendingPolicyEffectiveTs {
		return nil
	}
	if err := s.Store.UpdateSecretBlockPolicy(ctx, &store.UpdateSecretBlockPolicy{ID: g.ID, Policy: g.PendingPolicy}); err != nil {
		return errors.Wrap(err, "apply scheduled secret block policy")
	}
	g.Policy, g.PendingPolicy, g.PendingPolicyEffectiveTs = g.PendingPolicy, "", 0
	return nil
}

func (s *APIV1Service) latestSecretBlockUnlock(ctx context.Context, blockID int32) (*store.SecretBlockUnlock, error) {
	list, err := s.Store.ListSecretBlockUnlocks(ctx, &store.FindSecretBlockUnlock{SecretBlockID: blockID, Limit: 1})
	if err != nil {
		return nil, errors.Wrap(err, "list secret block unlocks")
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

// emergencyUsage returns how many emergency unlocks remain in the rolling window
// and, when none do, when the oldest one in the window ages out.
func (s *APIV1Service) emergencyUsage(ctx context.Context, blockID int32, p *secretBlockPolicy, now time.Time) (int, time.Time, error) {
	if p.EmergencyQuota <= 0 {
		return 0, time.Time{}, nil
	}
	after := now.Add(-p.emergencyWindow()).Unix()
	kind := store.SecretBlockUnlockEmergency
	used, err := s.Store.ListSecretBlockUnlocks(ctx, &store.FindSecretBlockUnlock{SecretBlockID: blockID, Kind: &kind, RequestedAfterTs: &after})
	if err != nil {
		return 0, time.Time{}, errors.Wrap(err, "list emergency unlocks")
	}
	remaining := p.EmergencyQuota - len(used)
	if remaining > 0 {
		return remaining, time.Time{}, nil
	}
	// Newest first: the quota frees up when the oldest counted use leaves the window.
	oldest := used[len(used)-1]
	return 0, time.Unix(oldest.RequestedTs, 0).Add(p.emergencyWindow()), nil
}

// buildSecretBlockRestriction reports a restricted block's state, or nil for an
// unrestricted one. The gate must already be settled.
func (s *APIV1Service) buildSecretBlockRestriction(ctx context.Context, g *secretBlockGate) (*v1pb.SecretBlockRestriction, error) {
	p, err := parseSecretBlockPolicy(g.Policy)
	if err != nil || p == nil {
		return nil, err
	}
	now := s.now()
	latest, err := s.latestSecretBlockUnlock(ctx, g.ID)
	if err != nil {
		return nil, err
	}
	state, expire := secretUnlockState(latest, p, now.Unix())
	r := &v1pb.SecretBlockRestriction{
		Policy:      convertSecretBlockPolicyToProto(p),
		UnlockState: state,
	}
	if state != v1pb.SecretBlockRestriction_LOCKED {
		r.Emergency = latest.Kind == store.SecretBlockUnlockEmergency
		r.AvailableTime = timestamppb.New(time.Unix(latest.AvailableTs, 0))
	}
	if expire > 0 {
		r.ExpireTime = timestamppb.New(time.Unix(expire, 0))
	}

	remaining, next, err := s.emergencyUsage(ctx, g.ID, p, now)
	if err != nil {
		return nil, err
	}
	r.EmergencyRemaining = int32(remaining)
	if !next.IsZero() {
		r.NextEmergencyTime = timestamppb.New(next)
	}
	kind := store.SecretBlockUnlockEmergency
	last, err := s.Store.ListSecretBlockUnlocks(ctx, &store.FindSecretBlockUnlock{SecretBlockID: g.ID, Kind: &kind, Limit: 1})
	if err != nil {
		return nil, errors.Wrap(err, "list emergency unlocks")
	}
	if len(last) > 0 {
		r.LastEmergencyTime = timestamppb.New(time.Unix(last[0].RequestedTs, 0))
		r.LastEmergencyReason = last[0].Reason
	}

	if g.PendingPolicyEffectiveTs > 0 {
		change := &v1pb.SecretBlockPendingPolicyChange{EffectiveTime: timestamppb.New(time.Unix(g.PendingPolicyEffectiveTs, 0))}
		pending, err := parseSecretBlockPolicy(g.PendingPolicy)
		if err != nil {
			return nil, err
		}
		if pending != nil {
			change.Policy = convertSecretBlockPolicyToProto(pending)
		}
		r.PendingChange = change
	}
	return r, nil
}

// loadOwnedSecretBlock fetches the caller's block with any due policy change
// applied. Returns NotFound for a missing or foreign block.
func (s *APIV1Service) loadOwnedSecretBlock(ctx context.Context, name string) (*store.SecretBlock, *secretBlockGate, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, nil, status.Errorf(codes.Unauthenticated, "authentication required")
	}
	uid, err := extractSecretBlockUID(name)
	if err != nil {
		return nil, nil, err
	}
	sb, err := s.Store.GetSecretBlock(ctx, &store.FindSecretBlock{UID: &uid, CreatorID: &user.ID})
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to get secret block: %v", err)
	}
	if sb == nil {
		return nil, nil, status.Errorf(codes.NotFound, "secret block not found")
	}
	gate := &secretBlockGate{ID: sb.ID, Policy: sb.Policy, PendingPolicy: sb.PendingPolicy, PendingPolicyEffectiveTs: sb.PendingPolicyEffectiveTs}
	if err := s.settleSecretBlockGate(ctx, gate); err != nil {
		return nil, nil, status.Errorf(codes.Internal, "%v", err)
	}
	sb.Policy, sb.PendingPolicy, sb.PendingPolicyEffectiveTs = gate.Policy, gate.PendingPolicy, gate.PendingPolicyEffectiveTs
	return sb, gate, nil
}

func (s *APIV1Service) secretBlockSummaryResponse(ctx context.Context, sb *store.SecretBlock, gate *secretBlockGate) (*v1pb.SecretBlockSummary, error) {
	restriction, err := s.buildSecretBlockRestriction(ctx, gate)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to read secret block restriction: %v", err)
	}
	return &v1pb.SecretBlockSummary{
		Name:           secretBlockName(sb.UID),
		Hint:           sb.Hint,
		CiphertextSize: int64(len(sb.Ciphertext)),
		CreateTime:     timestamppb.New(time.Unix(sb.CreatedTs, 0)),
		UpdateTime:     timestamppb.New(time.Unix(sb.UpdatedTs, 0)),
		Restriction:    restriction,
	}, nil
}

// passSecretBlockGate decides whether a restricted block's envelope may be served
// now, starting the viewing window on the first fetch of a READY request.
func (s *APIV1Service) passSecretBlockGate(ctx context.Context, gate *secretBlockGate) error {
	p, err := parseSecretBlockPolicy(gate.Policy)
	if err != nil {
		return status.Errorf(codes.Internal, "%v", err)
	}
	if p == nil {
		return nil
	}
	now := s.now().Unix()
	latest, err := s.latestSecretBlockUnlock(ctx, gate.ID)
	if err != nil {
		return status.Errorf(codes.Internal, "%v", err)
	}
	state, _ := secretUnlockState(latest, p, now)
	switch state {
	case v1pb.SecretBlockRestriction_OPEN:
		return nil
	case v1pb.SecretBlockRestriction_READY:
		if _, err := s.Store.OpenSecretBlockUnlock(ctx, latest.ID, now, now+p.ViewSeconds); err != nil {
			return status.Errorf(codes.Internal, "failed to open secret block: %v", err)
		}
		// Whether this call or a concurrent one started the window, the request
		// is now open; re-reading confirms it was not withdrawn in between.
		latest, err = s.latestSecretBlockUnlock(ctx, gate.ID)
		if err != nil {
			return status.Errorf(codes.Internal, "%v", err)
		}
		if state, _ := secretUnlockState(latest, p, now); state == v1pb.SecretBlockRestriction_OPEN {
			return nil
		}
	}
	return status.Errorf(codes.FailedPrecondition, "secret block is restricted and not unlocked")
}

func (s *APIV1Service) GetSecretBlockSummary(ctx context.Context, request *v1pb.GetSecretBlockSummaryRequest) (*v1pb.SecretBlockSummary, error) {
	sb, gate, err := s.loadOwnedSecretBlock(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	return s.secretBlockSummaryResponse(ctx, sb, gate)
}

func (s *APIV1Service) RequestSecretBlockUnlock(ctx context.Context, request *v1pb.RequestSecretBlockUnlockRequest) (*v1pb.SecretBlockSummary, error) {
	sb, gate, err := s.loadOwnedSecretBlock(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	p, err := parseSecretBlockPolicy(gate.Policy)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "%v", err)
	}
	if p == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "secret block is not restricted")
	}
	if normalizeTypedText(request.ConfirmText) != p.ConfirmText {
		return nil, status.Errorf(codes.InvalidArgument, "confirmation text does not match")
	}

	now := s.now()
	latest, err := s.latestSecretBlockUnlock(ctx, gate.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "%v", err)
	}
	state, _ := secretUnlockState(latest, p, now.Unix())
	// An emergency may overtake a request that is still waiting; anything else
	// would just stack requests.
	if state != v1pb.SecretBlockRestriction_LOCKED && !(request.Emergency && state == v1pb.SecretBlockRestriction_PENDING) {
		return nil, status.Errorf(codes.FailedPrecondition, "an unlock request is already active")
	}

	unlock := &store.SecretBlockUnlock{SecretBlockID: gate.ID, Kind: store.SecretBlockUnlockNormal, RequestedTs: now.Unix()}
	if request.Emergency {
		if p.EmergencyQuota <= 0 {
			return nil, status.Errorf(codes.FailedPrecondition, "this secret block has no emergency unlock")
		}
		statement := normalizeTypedText(request.EmergencyText)
		matched := false
		for _, want := range secretEmergencyStatements {
			if statement == want {
				matched = true
				break
			}
		}
		if !matched {
			return nil, status.Errorf(codes.InvalidArgument, "emergency statement does not match")
		}
		reason := strings.TrimSpace(request.EmergencyReason)
		if utf8.RuneCountInString(reason) < secretMinEmergencyReasonRunes {
			return nil, status.Errorf(codes.InvalidArgument, "emergency reason must be at least %d characters", secretMinEmergencyReasonRunes)
		}
		if len(reason) > secretMaxEmergencyReasonLength {
			return nil, status.Errorf(codes.InvalidArgument, "emergency reason is too long")
		}
		remaining, _, err := s.emergencyUsage(ctx, gate.ID, p, now)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "%v", err)
		}
		if remaining <= 0 {
			return nil, status.Errorf(codes.ResourceExhausted, "emergency unlock quota used up")
		}
		if state == v1pb.SecretBlockRestriction_PENDING {
			if err := s.Store.CancelSecretBlockUnlock(ctx, latest.ID, now.Unix()); err != nil {
				return nil, status.Errorf(codes.Internal, "failed to cancel pending unlock: %v", err)
			}
		}
		unlock.Kind = store.SecretBlockUnlockEmergency
		unlock.Reason = reason
		unlock.AvailableTs = now.Unix()
	} else {
		available, err := p.availableAt(now)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "%v", err)
		}
		unlock.AvailableTs = available.Unix()
	}
	if _, err := s.Store.CreateSecretBlockUnlock(ctx, unlock); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to request unlock: %v", err)
	}
	return s.secretBlockSummaryResponse(ctx, sb, gate)
}

func (s *APIV1Service) CancelSecretBlockUnlock(ctx context.Context, request *v1pb.CancelSecretBlockUnlockRequest) (*v1pb.SecretBlockSummary, error) {
	sb, gate, err := s.loadOwnedSecretBlock(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	p, err := parseSecretBlockPolicy(gate.Policy)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "%v", err)
	}
	if p == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "secret block is not restricted")
	}
	now := s.now().Unix()
	latest, err := s.latestSecretBlockUnlock(ctx, gate.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "%v", err)
	}
	if state, _ := secretUnlockState(latest, p, now); state != v1pb.SecretBlockRestriction_PENDING {
		return nil, status.Errorf(codes.FailedPrecondition, "no waiting unlock request")
	}
	if err := s.Store.CancelSecretBlockUnlock(ctx, latest.ID, now); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to cancel unlock: %v", err)
	}
	return s.secretBlockSummaryResponse(ctx, sb, gate)
}

func (s *APIV1Service) UpdateSecretBlockPolicy(ctx context.Context, request *v1pb.UpdateSecretBlockPolicyRequest) (*v1pb.SecretBlockSummary, error) {
	sb, gate, err := s.loadOwnedSecretBlock(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	var next *secretBlockPolicy
	if request.Policy != nil {
		if next, err = secretBlockPolicyFromRequest(request.Policy); err != nil {
			return nil, err
		}
	}
	nextRaw, err := marshalSecretBlockPolicy(next)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "%v", err)
	}
	current, err := parseSecretBlockPolicy(gate.Policy)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "%v", err)
	}

	update := &store.UpdateSecretBlockPolicy{ID: gate.ID}
	if current == nil {
		// Restricting an ordinary block only makes it harder to reach: immediate.
		// Lifting a restriction that does not exist is a no-op.
		update.Policy = nextRaw
	} else {
		// Every change to a restricted block waits as long as a normal unlock
		// would — otherwise changing the policy is the way around it.
		effective, err := current.availableAt(s.now())
		if err != nil {
			return nil, status.Errorf(codes.Internal, "%v", err)
		}
		update.Policy = gate.Policy
		update.PendingPolicy = nextRaw
		update.PendingPolicyEffectiveTs = effective.Unix()
	}
	if err := s.Store.UpdateSecretBlockPolicy(ctx, update); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update secret block policy: %v", err)
	}
	gate.Policy, gate.PendingPolicy, gate.PendingPolicyEffectiveTs = update.Policy, update.PendingPolicy, update.PendingPolicyEffectiveTs
	return s.secretBlockSummaryResponse(ctx, sb, gate)
}

func (s *APIV1Service) CancelSecretBlockPolicyChange(ctx context.Context, request *v1pb.CancelSecretBlockPolicyChangeRequest) (*v1pb.SecretBlockSummary, error) {
	sb, gate, err := s.loadOwnedSecretBlock(ctx, request.Name)
	if err != nil {
		return nil, err
	}
	if gate.PendingPolicyEffectiveTs == 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "no scheduled policy change")
	}
	if err := s.Store.UpdateSecretBlockPolicy(ctx, &store.UpdateSecretBlockPolicy{ID: gate.ID, Policy: gate.Policy}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to cancel policy change: %v", err)
	}
	gate.PendingPolicy, gate.PendingPolicyEffectiveTs = "", 0
	return s.secretBlockSummaryResponse(ctx, sb, gate)
}
