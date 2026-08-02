export interface KernelService {

  readonly id: string;

  initialize(): Promise<void>;

  shutdown(): Promise<void>;

}