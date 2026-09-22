export const LOGISTICS_ADMIN_TASKS_COL = 'logisticsAdminTasks';

export type LogisticsAdminTask = {
  id: string;
  title: string;
  notes?: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
  createdByName: string;
  doneAt?: string | null;
  doneByUid?: string | null;
  order?: number;
};
