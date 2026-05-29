---
name: home-assistant-dashboards
description: Safely inspect and edit Home Assistant Lovelace dashboards that are primarily UI/storage-managed, especially in this homelab Kubernetes setup. Use when the user asks to create, modify, debug, migrate, or review Home Assistant dashboards/cards/views without making dashboards GitOps-managed.
---

# Home Assistant Dashboards

## Principle

Dashboards are user-facing UI state. Prefer Home Assistant **storage/UI-managed dashboards** over GitOps YAML dashboards unless the user explicitly asks for dashboard-as-code.

For normal multi-card dashboard layout, use view-level layout such as `type: masonry` with cards directly under the view. **Never wrap multiple dashboard cards in a Lovelace `grid` card unless the user explicitly says: "put everything in a single card".** A `grid` card is itself one constrained card and can make the layout narrow/tiny; it is not the same thing as a full-width masonry dashboard layout.

In this homelab repo, do **not** add Lovelace dashboard YAML to `kubernetes/apps/homeassistant/configuration.yaml`, ConfigMaps, or Deployment mounts by default. That causes Flux/Kubernetes config changes and can restart Home Assistant.

## Quick workflow

1. Read repo guidance first if in a repo: `AGENTS.md`, `README.md`, and `Makefile`.
2. Use the kubeconfig path from `Makefile`:
   - `kubectl --kubeconfig=talos/generated/kubeconfig -n homeassistant ...`
3. Inspect dashboards from HA storage files in the HA pod:
   - `/config/.storage/lovelace_dashboards`
   - `/config/.storage/lovelace*`
4. Before editing any `.storage` file, create a timestamped backup in the pod.
5. Edit only the specific dashboard storage file, preserving the HA storage wrapper keys.
6. Prefer standard Lovelace JSON-compatible structures.
7. Tell the user to refresh the browser; avoid restarting HA unless necessary.

## Commands

List dashboard registry and dashboard files:

```bash
kubectl --kubeconfig=talos/generated/kubeconfig -n homeassistant exec -i deploy/homeassistant -- \
  sh -c 'ls -la /config/.storage | grep lovelace'
```

Print a storage dashboard as JSON:

```bash
kubectl --kubeconfig=talos/generated/kubeconfig -n homeassistant exec -i deploy/homeassistant -- python3 - <<'PY'
import json
p='/config/.storage/lovelace.dashboard_cameras'
print(json.dumps(json.load(open(p)), indent=2))
PY
```

Find camera entity IDs or dashboard references:

```bash
kubectl --kubeconfig=talos/generated/kubeconfig -n homeassistant exec -i deploy/homeassistant -- \
  sh -c 'grep -R "camera\." -n /config/.storage/lovelace* 2>/dev/null | head -200'
```

List camera entities from the entity registry:

```bash
kubectl --kubeconfig=talos/generated/kubeconfig -n homeassistant exec -i deploy/homeassistant -- python3 - <<'PY'
import json
p='/config/.storage/core.entity_registry'
for e in json.load(open(p)).get('data',{}).get('entities',[]):
    eid=e.get('entity_id','')
    if eid.startswith('camera.'):
        print(eid)
PY
```

## Safe edit pattern

Use Python inside the HA pod so file ownership/path semantics stay local to HA's PVC.

```bash
kubectl --kubeconfig=talos/generated/kubeconfig -n homeassistant exec -i deploy/homeassistant -- \
  sh -c 'cp /config/.storage/lovelace.dashboard_cameras /config/.storage/lovelace.dashboard_cameras.bak.$(date +%Y%m%d%H%M%S)'

kubectl --kubeconfig=talos/generated/kubeconfig -n homeassistant exec -i deploy/homeassistant -- python3 - <<'PY'
import json, os, tempfile
path='/config/.storage/lovelace.dashboard_cameras'
with open(path) as f:
    doc=json.load(f)

# Edit only doc['data']['config']; preserve version/minor_version/key/data wrapper.
doc['data']['config'] = {
  'views': [{
    'type': 'masonry',
    'title': 'Cameras',
    'path': 'cameras',
    'icon': 'mdi:cctv',
    'cards': [
      {'type':'picture-entity','entity':'camera.front_door_live_view','name':'Front Door','camera_view':'live','show_state':False},
    ],
  }]
}

fd,tmp=tempfile.mkstemp(dir=os.path.dirname(path), prefix='.lovelace.', text=True)
with os.fdopen(fd,'w') as f:
    json.dump(doc, f, indent=2)
    f.write('\n')
os.replace(tmp, path)
PY
```

## Dashboard registry notes

`/config/.storage/lovelace_dashboards` maps dashboard IDs to files. Example item:

```json
{
  "id": "dashboard_cameras",
  "show_in_sidebar": true,
  "title": "Cameras",
  "require_admin": false,
  "mode": "storage",
  "url_path": "dashboard-cameras",
  "icon": "mdi:cctv"
}
```

The matching config file is usually:

```text
/config/.storage/lovelace.dashboard_cameras
```

## Avoid unless explicitly requested

- Do not make dashboards GitOps-managed by adding `lovelace: dashboards:` YAML to `configuration.yaml`.
- Do not mount dashboard YAML through Kubernetes ConfigMaps.
- Do not edit HA `.storage` files without backing them up.
- Do not restart Home Assistant just to see Lovelace card changes; browser refresh is usually enough.
