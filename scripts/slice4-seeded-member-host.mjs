/** Host the seeded-member controlled app for the Slice 4 reference pilot.
 * The app implements the reference-task surface: role sessions (admin/member),
 * locale rendering, and a toggleable layout defect (POST /control/defect). */
import { listenSeededMemberApp } from "../packages/core/src/seeded-member-app.ts";

const port = Number(process.argv[2] ?? 8791);
const defect = process.argv[3] === "defect";
await listenSeededMemberApp({ port, defect });
process.stdout.write(`seeded-member ready on ${port} defect=${defect}\n`);
