// The deletion decision for a signed-in user, with its side effects injected so scripts/test-migrations can run both paths for real
// against Postgres (pglite). Pure TypeScript, no Deno APIs.
export interface DeleteDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
  deleteAuthUser(id: string): Promise<string | null>   // error message or null
  unlinkIdentity(identityId: string): Promise<boolean>
}
export type DeleteResult =
  | { ok: true; authUserDeleted: boolean; appleUnlinked: boolean | null }
  | { ok: false; stage: 'rows' | 'auth'; error: string }   // 'rows': nothing was deleted. 'auth': the Fanday rows are gone, the account itself remains.

export async function deleteAccount(userId: string, d: DeleteDeps, opts: { appleIdentityId: string | null }): Promise<DeleteResult> {
  // Decide first (read-only), then delete. Fails closed: if we cannot tell, the auth user is kept.
  const dec = await d.rpc('auth_user_deletable', { p_user: userId })
  const info = (dec.error ? null : dec.data) as { deletable?: boolean; apple_added_by_fanday?: boolean } | null
  const deletable = info?.deletable === true
  const rows = await d.rpc('delete_user_data', { p_user: userId })
  if (rows.error) return { ok: false, stage: 'rows', error: rows.error.message }
  if (deletable) {
    // Re-check right before the delete, in this same request: another app may have written a row since the first look. If it did (or we
    // cannot tell), the auth user is kept and we fall through to unlink-only.
    const again = await d.rpc('user_has_foreign_rows', { p_user: userId })
    if (!again.error && again.data === false) {
      const err = await d.deleteAuthUser(userId)
      if (err) return { ok: false, stage: 'auth', error: err }   // origin row kept, so the retry takes the same path
      await d.rpc('delete_user_origin', { p_user: userId }) // best effort: purge_orphaned_user_rows sweeps it otherwise
      return { ok: true, authUserDeleted: true, appleUnlinked: null }
    }
  }
  // Unlink only: the Fanday rows are gone, the auth user stays (another app may use it). Remove the Apple identity ONLY if Fanday added it.
  await d.rpc('delete_user_origin', { p_user: userId })
  const unlinked = opts.appleIdentityId && info?.apple_added_by_fanday === true ? await d.unlinkIdentity(opts.appleIdentityId).catch(() => false) : opts.appleIdentityId ? false : null
  return { ok: true, authUserDeleted: false, appleUnlinked: unlinked }
}
