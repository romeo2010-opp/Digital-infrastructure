import { UserSettingsWorkspace } from '../../features/settings/UserSettingsWorkspace'

export function SettingsScreen({
  profile,
  station,
  theme = 'light',
  notificationsEnabled = false,
  notificationsPermission = 'default',
  onToggleNotifications,
  onSaveProfile,
  onOpenWallet,
  onLogout,
  onThemeChange,
}) {
  return (
    <section>
      <header className='screen-header'>
        <h2>Settings</h2>
        <p>Manage your identity, alerts, and billing.</p>
      </header>

      <UserSettingsWorkspace
        profile={profile}
        station={station}
        theme={theme}
        notificationsEnabled={notificationsEnabled}
        notificationsPermission={notificationsPermission}
        onToggleNotifications={onToggleNotifications}
        onSaveProfile={onSaveProfile}
        onOpenWallet={onOpenWallet}
        onLogout={onLogout}
        onThemeChange={onThemeChange}
      />
    </section>
  )
}
