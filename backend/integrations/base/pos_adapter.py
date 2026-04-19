from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class POSResult:
    ok: bool
    external_id: str | None = None
    error: str | None = None
    raw: dict | None = None


class BasePOSAdapter(ABC):
    def __init__(self, restaurant, credentials: dict):
        self.restaurant = restaurant
        self.credentials = credentials

    @abstractmethod
    def push_order(self, order) -> POSResult:
        """Push a new order to the POS. Returns POSResult."""
        ...

    @abstractmethod
    def update_order_status(self, order, new_status: str) -> POSResult:
        """Update an existing order's status in the POS."""
        ...

    @abstractmethod
    def check_availability(self, item_names: list[str]) -> dict[str, bool]:
        """Check if items are available. Returns {item_name: is_available}."""
        ...

    @abstractmethod
    def sync_menu(self, items) -> POSResult:
        """Push menu items to the POS."""
        ...
