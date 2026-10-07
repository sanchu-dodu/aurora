import { runDoctor, type DoctorOptions } from "../services/doctor.js";

export async function doctorCommand(options: DoctorOptions = {}) {
  await runDoctor(undefined, options);
}
