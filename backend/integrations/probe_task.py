"""One-off diagnostic task: probe the live Foodics menu for which cards match a
given item name. Runs ON the qcluster worker (enqueue via async_task) so it
shares the SAME singleton browser/session as order pushes — never opening a
second Foodics login. Writes the result as JSON to out_path. Non-destructive:
probe_find navigates away without saving any order."""
import json
import logging
from pathlib import Path

logger = logging.getLogger('prime.integrations')


def run_probe(restaurant_slug, names, out_path, platform_slug='toters'):
    result = {}
    try:
        from restaurants.models import Restaurant
        from integrations.laffe.adapter import LaffeAdapter
        r = Restaurant.objects.get(slug=restaurant_slug)
        adapter = LaffeAdapter(r, {})
        result = adapter.probe_find(platform_slug=platform_slug, names=tuple(names))
    except Exception as e:
        result = {'error': repr(e)}
        logger.exception('[probe] run_probe failed')
    try:
        Path(out_path).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    except Exception:
        logger.exception('[probe] failed to write %s', out_path)
    return out_path
