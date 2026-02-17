'use server'

import { deleteUsersByIds, updateUserTwilioPhone } from "@/lib/dal";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function deleteUsers(ids: string[]) {
  try {
    // Verify user is authenticated
    const session = await getSession();
    if (!session?.userId) {
      return {
        success: false,
        message: "Unauthorized",
      };
    }

    if (session.role !== 'admin') {
      return {
        success: false,
        message: "Forbidden: Admin access required",
      };
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return {
        success: false,
        message: "No IDs provided",
      };
    }

    // Prevent admin from deleting themselves
    if (ids.includes(session.userId)) {
      return {
        success: false,
        message: "Cannot delete your own account",
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
      message: "An error occurred while deleting users",
    };
  }
}

export async function updateTwilioPhone(userId: string, twilioPhoneNumber: string) {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return { success: false, message: "Unauthorized" };
    }

    if (session.role !== 'admin') {
      return { success: false, message: "Admin access required" };
    }

    const phone = twilioPhoneNumber.trim() || null;
    await updateUserTwilioPhone(userId, phone);

    revalidatePath('/admin');
    return { success: true, message: "Phone number updated" };
  } catch (err) {
    console.error("Update phone error:", err);
    return { success: false, message: "Failed to update phone number" };
  }
}