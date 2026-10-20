/**
 * Whether the browser has the Notification API and permission to use it.
 * iOS Safari (outside an installed web app) has no `Notification` global at
 * all, so it must be checked with `in` before it is touched.
 * @param win Window to look at
 * @returns True if notifications can be shown
 */
export function canShowNotifications(win: object = window): boolean {
  return (
    "Notification" in win &&
    (win as { Notification: { permission: string } }).Notification
      .permission === "granted"
  );
}

/**
 * Show a notification without ever throwing. Some browsers (Android Chrome)
 * throw "Illegal constructor" from `new Notification`.
 * @param title Title
 * @param options Notification options
 * @param onClick Called when the notification is clicked
 * @returns Whether a notification was created
 */
export function tryShowNotification(
  title: string,
  options: NotificationOptions,
  onClick: () => void,
): boolean {
  try {
    const notification = new Notification(title, options);
    notification.addEventListener("click", onClick);
    return true;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[notifications] failed", error);
    return false;
  }
}
