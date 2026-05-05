import { Download, Search, Plus, UserPlus } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';

const users = [
  { name: 'Peter Kamau', role: 'Senior Inspector', district: 'Nairobi', activeCases: 12, lastLogin: '2024-05-05 09:45', accountStatus: 'Active' },
  { name: 'Jane Mwangi', role: 'Field Officer', district: 'Nairobi', activeCases: 8, lastLogin: '2024-05-05 10:12', accountStatus: 'Active' },
  { name: 'Michael Otieno', role: 'Compliance Officer', district: 'Nairobi', activeCases: 15, lastLogin: '2024-05-05 08:30', accountStatus: 'Active' },
  { name: 'Anne Njeri', role: 'Field Officer', district: 'Kiambu', activeCases: 6, lastLogin: '2024-05-04 16:45', accountStatus: 'Active' },
  { name: 'David Ochieng', role: 'Senior Inspector', district: 'Mombasa', activeCases: 10, lastLogin: '2024-05-03 14:20', accountStatus: 'Suspended' },
];

export function UserAdministration() {
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <button className="bg-cyan-700 hover:bg-cyan-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-white">
          <UserPlus className="w-3 h-3" />
          Add User
        </button>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-3 h-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search users..."
            className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300 flex-1"
          />
        </div>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Roles</option>
          <option>Senior Inspector</option>
          <option>Field Officer</option>
          <option>Compliance Officer</option>
        </select>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Districts</option>
          <option>Nairobi</option>
          <option>Mombasa</option>
        </select>
        <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-slate-300">
          <Download className="w-3 h-3" />
          Export
        </button>
      </Toolbar>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="bg-slate-900 border border-slate-700 rounded">
          <div className="border-b border-slate-700 px-3 py-2">
            <h3 className="text-sm font-medium text-slate-200 uppercase">MERA Officer Registry</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-400 uppercase">
                <tr>
                  <th className="px-2 py-1.5 text-left">Officer Name</th>
                  <th className="px-2 py-1.5 text-left">Role</th>
                  <th className="px-2 py-1.5 text-left">District</th>
                  <th className="px-2 py-1.5 text-center">Active Cases</th>
                  <th className="px-2 py-1.5 text-left">Last Login</th>
                  <th className="px-2 py-1.5 text-left">Account Status</th>
                  <th className="px-2 py-1.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {users.map((user, idx) => (
                  <tr key={idx} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-2 py-1.5 font-medium">{user.name}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        user.role === 'Senior Inspector' ? 'bg-purple-900/30 border border-purple-600 text-purple-400' :
                        user.role === 'Compliance Officer' ? 'bg-blue-900/30 border border-blue-600 text-blue-400' :
                        'bg-emerald-900/30 border border-emerald-600 text-emerald-400'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{user.district}</td>
                    <td className="px-2 py-1.5 text-center font-bold text-cyan-400">{user.activeCases}</td>
                    <td className="px-2 py-1.5 text-slate-400">{user.lastLogin}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        user.accountStatus === 'Active'
                          ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400'
                          : 'bg-red-900/30 border border-red-600 text-red-400'
                      }`}>
                        {user.accountStatus}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button className="text-cyan-400 hover:text-cyan-300 text-xs underline">Manage</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
