export type StateChangeKind =
  | "state"
  | "opening"
  | "debt"
  | "tax"
  | "reset"
  | "restore"
  | "rbac"
  | "notification"
  | "e-invoice";

export type EntityLifecycleAction =
  | "DATA_CREATED"
  | "DATA_UPDATED"
  | "DATA_SOFT_DELETED"
  | "DATA_DELETE_REQUESTED"
  | "DATA_DELETE_APPROVED"
  | "DATA_DELETED"
  | "DATA_RESTORED"
  | "DATA_ARCHIVED"
  | "DATA_PURGED";

export type EntityLifecycleMeta = {
  action: EntityLifecycleAction;
  entityType: string;
  entityId: string;
  version: number;
  status: string;
  actorUserId?: string;
};
