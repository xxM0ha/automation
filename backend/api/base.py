from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated


class TenantScopedViewSet(viewsets.ModelViewSet):
    """
    Base ViewSet that automatically scopes all queries to the current user's restaurant.
    Every resource ViewSet MUST inherit from this.
    """
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        restaurant = self.request.user.current_restaurant
        if restaurant is None:
            return self.model.objects.none()
        return self.model.objects.filter(restaurant=restaurant)

    def perform_create(self, serializer):
        serializer.save(restaurant=self.request.user.current_restaurant)
