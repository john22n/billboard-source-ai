'use server'

import { deleteUsersByIds } from "@/lib/dal";
import { revalidatePath } from "next/cache";

export async function deleteUsers(ids: string[]) {
  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return {
        success: false,
        message: "No IDs provided",
      };
    }

    await deleteUsersByIds(ids);
    
    // Revalidate the admin page to refresh data
    revalidatePath('/admin');
    
    return { success: true };
  } catch (err) {
    console.error("Delete error:", err);
    return {
      success: false,
      message: (err as Error).message,
    };
  }
}