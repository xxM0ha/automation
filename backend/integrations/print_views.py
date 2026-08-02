"""Local print-agent queue.

A Windows agent on the branch LAN authenticates as the restaurant account and:
  GET  /api/print-jobs/       → pending order tickets to print
  POST /api/print-jobs/ack/   → { ids: [...] } to consume the ones it printed
"""
import logging

from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import PrintJob, Printer

logger = logging.getLogger('prime.integrations')


def _printer_info(p):
    return {
        'id': p.id, 'name': p.name, 'ip': p.ip, 'port': p.port,
        'paper_width': p.paper_width, 'role': p.role,
    }


def _item_dict(it):
    return {'name': it.name_snapshot, 'qty': it.qty, 'notes': it.notes}


@api_view(['GET'])
def print_jobs(request):
    """Pending print jobs for the caller's restaurant (token-authed).

    Each job carries pre-computed `groups`: one per printer that should print.
    Station printers get only the items routed to them (MenuItem.printer);
    cashier printers get the whole order. The agent prints each group to its IP.
    """
    restaurant = request.user.current_restaurant
    if restaurant is None:
        return Response([])

    printers = list(restaurant.printers.filter(active=True))
    printers_by_id = {p.id: p for p in printers}
    cashiers = [p for p in printers if p.role == Printer.ROLE_CASHIER]

    jobs = (
        PrintJob.objects
        .filter(restaurant=restaurant, printed=False)
        .select_related('order', 'order__platform')
        .prefetch_related('order__order_items', 'order__order_items__menu_item')
    )
    out = []
    for j in jobs[:50]:
        o = j.order
        items = list(o.order_items.all())

        # station printers: bucket each item by its routed (active, station) printer
        station_buckets = {}
        for it in items:
            mi = it.menu_item
            pid = mi.printer_id if (mi and mi.printer_id) else None
            pr = printers_by_id.get(pid) if pid else None
            if pr and pr.role == Printer.ROLE_STATION:
                station_buckets.setdefault(pr.id, []).append(_item_dict(it))

        groups = [
            {'printer': _printer_info(printers_by_id[pid]), 'items': its}
            for pid, its in station_buckets.items()
        ]
        # cashier printers get the full order
        all_items = [_item_dict(it) for it in items]
        for c in cashiers:
            groups.append({'printer': _printer_info(c), 'items': all_items})

        out.append({
            'id': j.id,
            'order': {
                'external_id': o.external_id,
                'platform': o.platform.name_ar if o.platform else '',
                'customer_name': o.customer_name,
                'notes': o.notes,
                'total': str(o.total),
                'created_at': o.created_at.isoformat(),
            },
            'groups': groups,
        })
    return Response(out)


@api_view(['POST'])
def print_ack(request):
    """Consume jobs the agent printed successfully. Body: { ids: [..] }."""
    restaurant = request.user.current_restaurant
    ids = request.data.get('ids') or []
    if restaurant is None or not isinstance(ids, list) or not ids:
        return Response({'deleted': 0})
    deleted, _ = PrintJob.objects.filter(restaurant=restaurant, id__in=ids).delete()
    return Response({'deleted': deleted})
