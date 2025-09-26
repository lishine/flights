# Simple Flight Tracking Logic - Correct Implementation

## Understanding the Requirements

The user is absolutely right - I overcomplicated this. The logic should be super simple:

1. **Every 2 minutes**: Fetch current flights
2. **Store current** as `latest-arrivals` (24h TTL)
3. **Get previous** from `prev-arrivals` (flights from 2 minutes ago)
4. **Compare ONLY tracked flights** between prev and current
5. **Send alerts** to users tracking those specific changed flights
6. **Store current as prev** for next cycle: `prev-arrivals = current`

## Key Points

- `prev-arrivals` is just the flights from 2 minutes ago
- We only check changes for flights that users are actually tracking
- No complex hashing or global change detection needed
- Simple: current → latest-arrivals, current → prev-arrivals
- Compare prev vs current only for tracked flights
- Log detailed prev/current data for each changed tracked flight

## Storage Keys (from design.md)

- `latest-arrivals`: Current flight data (24h TTL)
- `prev-arrivals`: Previous flight data for comparison (24h TTL)
- `tracking:LY086`: List of user IDs tracking flight LY086 (7d TTL)
- `user_tracks:user123`: List of flights tracked by user123 (7d TTL)

## Implementation Plan

1. **runScheduledJob**:

   - Fetch current flights
   - Store as `latest-arrivals` (24h TTL)
   - Get `prev-arrivals`
   - Call alerts with prev and current
   - Store current as `prev-arrivals` (24h TTL)

2. **sendFlightAlerts**:

   - Get all tracking keys to find which flights are tracked
   - For each tracked flight, compare prev vs current
   - Log detailed changes with prev/current data
   - Send alerts only to users tracking that specific flight

3. **Remove all the complex logic** I added (hashing, global change detection, etc.)

4. **Keep it simple** as per the original design document
