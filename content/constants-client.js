import { getConstants as provide } from "../modules/constants-provider.js";

export async function getConstants() {
    return provide();
}
