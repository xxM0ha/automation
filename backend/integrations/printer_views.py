"""Restaurant-facing printer management + per-item routing (dashboard).

  GET    /api/printers/                 → list this branch's printers
  POST   /api/printers/                 → create a printer
  PATCH  /api/printers/<id>/            → update a printer
  DELETE /api/printers/<id>/            → delete a printer
  GET    /api/printers/routing/         → all menu items with their printer
  POST   /api/printers/routing/         → { itemId, printerId|null } set one item
  POST   /api/printers/routing/bulk/    → { itemIds:[...], printerId|null } set many

NOTE: the global CamelCase parser/renderer is active, so request bodies arrive
underscoreized (read snake_case here) and snake_case responses go out camelCased.
"""
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from menu.models import MenuItem
from .models import Printer

VALID_ROLES = (Printer.ROLE_STATION, Printer.ROLE_CASHIER)


def _ser(p):
    return {
        'id': p.id, 'name': p.name, 'ip': p.ip, 'port': p.port,
        'paper_width': p.paper_width, 'role': p.role, 'active': p.active,
    }


@api_view(['GET', 'POST'])
def printers(request):
    restaurant = request.user.current_restaurant
    if restaurant is None:
        return Response({'detail': 'no restaurant'}, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'GET':
        return Response([_ser(p) for p in restaurant.printers.all()])
    d = request.data
    role = d.get('role') if d.get('role') in VALID_ROLES else Printer.ROLE_STATION
    p = Printer.objects.create(
        restaurant=restaurant,
        name=(d.get('name') or 'طابعة').strip(),
        ip=(d.get('ip') or '').strip(),
        port=int(d.get('port') or 9100),
        paper_width=int(d.get('paper_width') or 576),
        role=role,
        active=bool(d.get('active', True)),
    )
    return Response(_ser(p), status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def printer_detail(request, pk):
    restaurant = request.user.current_restaurant
    if restaurant is None:
        return Response({'detail': 'no restaurant'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        p = restaurant.printers.get(pk=pk)
    except Printer.DoesNotExist:
        return Response({'detail': 'not found'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'DELETE':
        p.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    d = request.data
    if 'name' in d:
        p.name = (d['name'] or '').strip()
    if 'ip' in d:
        p.ip = (d['ip'] or '').strip()
    if 'port' in d:
        p.port = int(d['port'] or 9100)
    if 'paper_width' in d:
        p.paper_width = int(d['paper_width'] or 576)
    if 'role' in d and d['role'] in VALID_ROLES:
        p.role = d['role']
    if 'active' in d:
        p.active = bool(d['active'])
    p.save()
    return Response(_ser(p))


@api_view(['GET', 'POST'])
def routing(request):
    """GET → every menu item with its assigned printer. POST → route one item."""
    restaurant = request.user.current_restaurant
    if restaurant is None:
        return Response({'detail': 'no restaurant'}, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'GET':
        items = (restaurant.menu_items
                 .select_related('category')
                 .order_by('category__sort_order', 'name'))
        return Response([{
            'id': it.id,
            'name': it.name,
            'category': it.category.name_ar if it.category else '',
            'printer_id': it.printer_id,
        } for it in items])
    # POST: set a single item's printer
    try:
        it = restaurant.menu_items.get(pk=request.data.get('item_id'))
    except MenuItem.DoesNotExist:
        return Response({'detail': 'item not found'}, status=status.HTTP_404_NOT_FOUND)
    try:
        it.printer = _resolve_printer(restaurant, request.data.get('printer_id'))
    except Printer.DoesNotExist:
        return Response({'detail': 'printer not found'}, status=status.HTTP_404_NOT_FOUND)
    it.save(update_fields=['printer'])
    return Response({'id': it.id, 'printer_id': it.printer_id})


@api_view(['POST'])
def routing_bulk(request):
    """Route many items to one printer at once. Body: { itemIds:[], printerId|null }."""
    restaurant = request.user.current_restaurant
    item_ids = request.data.get('item_ids') or []
    if restaurant is None or not isinstance(item_ids, list):
        return Response({'updated': 0}, status=status.HTTP_400_BAD_REQUEST)
    try:
        printer = _resolve_printer(restaurant, request.data.get('printer_id'))
    except Printer.DoesNotExist:
        return Response({'detail': 'printer not found'}, status=status.HTTP_404_NOT_FOUND)
    updated = restaurant.menu_items.filter(id__in=item_ids).update(printer=printer)
    return Response({'updated': updated})


def _resolve_printer(restaurant, printer_id):
    if printer_id in (None, '', 0, '0'):
        return None
    return restaurant.printers.get(pk=printer_id)
