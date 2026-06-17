import { Device, DeviceStatus } from '@shared/types';

export function resolveDeviceStatusFromExpiry(expiryDate: string | undefined): DeviceStatus {
  if (!expiryDate) return DeviceStatus.ACTIVE;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return DeviceStatus.ACTIVE;
  expiry.setHours(0, 0, 0, 0);
  return expiry < today ? DeviceStatus.EXPIRED : DeviceStatus.ACTIVE;
}

export function normalizeDeviceStatus<T extends Pick<Device, 'expiryDate' | 'status'>>(device: T): T {
  return {
    ...device,
    status: resolveDeviceStatusFromExpiry(device.expiryDate),
  };
}
