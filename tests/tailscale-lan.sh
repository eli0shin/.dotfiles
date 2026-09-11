#!/usr/bin/env bash
set -euo pipefail

# All network changes occur in a new, unprivileged network namespace.
[[ "$(uname -s)" == Linux ]] || { echo 'SKIP: Linux routing test'; exit 0; }
script=$(realpath "$(dirname "$0")/../scripts/services/tailscale-lan.sh")
unshare --user --map-root-user --net /bin/bash -s -- "$script" <<'TEST'
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
script=$1
ip link set lo up
for device in lan wan tailscale0; do
    ip link add "$device" type dummy
    ip link set "$device" up
done
ip address add 192.0.2.2/24 dev wan
ip route add default via 192.0.2.1 dev wan
ip address add 192.168.1.253/24 dev lan
ip address add 100.64.0.2/32 dev tailscale0
for subnet in 192.168.1.0/24 10.77.10.0/24 100.64.0.0/10; do
    ip route add table 52 "$subnet" dev tailscale0
done
ip rule add priority 5270 lookup 52

expect_device() {
    local route
    route=$(ip -4 route get "$1")
    [[ " $route " == *" dev $2 "* ]] || {
        echo "FAIL: $1 should use $2, got $route" >&2
        exit 1
    }
}

expect_device 192.168.1.20 tailscale0
/bin/bash "$script" apply
expect_device 192.168.1.20 lan
expect_device 192.168.1.10 lan
expect_device 10.77.10.41 tailscale0
expect_device 100.100.100.100 tailscale0
expect_device 1.1.1.1 wan

/bin/bash "$script" apply
[[ $(ip -4 rule show priority 2500 | wc -l) -eq 1 ]]

# Away: a local default gateway must not intercept home traffic.
ip address del 192.168.1.253/24 dev lan
expect_device 192.168.1.20 tailscale0
expect_device 10.77.10.41 tailscale0
expect_device 1.1.1.1 wan

# Returning home changes route selection without toggling Tailscale or the rule.
ip address add 192.168.1.253/24 dev lan
expect_device 192.168.1.20 lan
/bin/bash "$script" remove
expect_device 192.168.1.20 tailscale0
/bin/bash "$script" remove

# Never overwrite or delete a different rule at the chosen priority.
ip rule add priority 2500 to 203.0.113.0/24 lookup main
if /bin/bash "$script" apply; then
    echo 'FAIL: accepted a conflicting priority' >&2
    exit 1
fi
if /bin/bash "$script" remove; then
    echo 'FAIL: removed a conflicting rule' >&2
    exit 1
fi
[[ $(ip -4 rule show priority 2500) == *203.0.113.0/24* ]]
ip rule del priority 2500 to 203.0.113.0/24 lookup main

# Also reject multiple rules at that priority, even if one is ours.
/bin/bash "$script" apply
ip rule add priority 2500 to 203.0.113.0/24 lookup main
if /bin/bash "$script" apply; then
    echo 'FAIL: accepted duplicate priorities' >&2
    exit 1
fi
[[ $(ip -4 rule show priority 2500 | wc -l) -eq 2 ]]
echo 'PASS: home LAN, roaming fallback, Tailscale destinations, idempotence, rollback, conflicts'
TEST
