import { Badge, type BadgeProps } from "@/components/ui/badge";

const statusConfig: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  // Delivery statuses
  pending: { label: "Pending", variant: "warning" },
  assigned: { label: "Assigned", variant: "default" },
  in_transit: { label: "In Transit", variant: "default" },
  delivered: { label: "Delivered", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "destructive" },

  // Driver statuses
  available: { label: "Available", variant: "success" },
  checked_in: { label: "Checked In", variant: "success" },
  on_route: { label: "On Route", variant: "default" },
  offline: { label: "Offline", variant: "outline" },

  // Verification statuses
  verified: { label: "Verified", variant: "success" },
  unverified: { label: "Unverified", variant: "warning" },
  vetted: { label: "Vetted", variant: "success" },
  not_vetted: { label: "Not Vetted", variant: "warning" },

  // Session statuses
  active: { label: "Active", variant: "success" },
  released: { label: "Released", variant: "default" },
  completed: { label: "Completed", variant: "success" },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || {
    label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    variant: "outline" as const,
  };

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
