import { Plus, Download, Search, Image } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';

const complaints = [
  { id: 'CMP-7842', station: 'Shell Westlands', type: 'Queue Violence', source: 'Citizen', district: 'Nairobi', submitted: '2024-05-05 09:30', officer: 'P. Kamau', status: 'Under Investigation', priority: 'High' },
  { id: 'CMP-7841', station: 'Hashi Ngong', type: 'Fuel Hoarding', source: 'MERA Patrol', district: 'Nairobi', submitted: '2024-05-05 08:15', officer: 'J. Mwangi', status: 'Evidence Review', priority: 'Critical' },
  { id: 'CMP-7840', station: 'Total Mombasa Rd', type: 'Price Violation', source: 'Citizen', district: 'Nairobi', submitted: '2024-05-05 07:45', officer: 'M. Otieno', status: 'Resolved', priority: 'Medium' },
  { id: 'CMP-7839', station: 'Rubis Thika', type: 'Illegal Vending', source: 'Anonymous', district: 'Kiambu', submitted: '2024-05-04 16:20', officer: 'A. Njeri', status: 'Assigned', priority: 'High' },
  { id: 'CMP-7838', station: 'Kenol Nakuru', type: 'Quality Issues', source: 'Citizen', district: 'Nakuru', submitted: '2024-05-04 14:10', officer: 'P. Kamau', status: 'Under Investigation', priority: 'Medium' },
];

const evidenceQueue = [
  { id: 'EVD-445', type: 'Photo', station: 'Shell Westlands', submitted: '15 min ago' },
  { id: 'EVD-444', type: 'Video', station: 'Hashi Ngong', submitted: '1 hour ago' },
  { id: 'EVD-443', type: 'Photo', station: 'Total CBD', submitted: '2 hours ago' },
];

export function ComplaintsCenter() {
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <button className="bg-cyan-700 hover:bg-cyan-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-white">
          <Plus className="w-3 h-3" />
          New Complaint Intake
        </button>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Types</option>
          <option>Fuel Hoarding</option>
          <option>Queue Violence</option>
          <option>Price Violation</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" className="rounded" />
          Unresolved Only
        </label>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Officers</option>
          <option>P. Kamau</option>
          <option>J. Mwangi</option>
        </select>
        <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-slate-300">
          <Download className="w-3 h-3" />
          Export
        </button>
      </Toolbar>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="bg-slate-900 border border-slate-700 rounded mb-3">
          <div className="border-b border-slate-700 px-3 py-2">
            <h3 className="text-sm font-medium text-slate-200 uppercase">Complaint Registry</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-400 uppercase">
                <tr>
                  <th className="px-2 py-1.5 text-left">Complaint ID</th>
                  <th className="px-2 py-1.5 text-left">Station</th>
                  <th className="px-2 py-1.5 text-left">Complaint Type</th>
                  <th className="px-2 py-1.5 text-left">Reporter Source</th>
                  <th className="px-2 py-1.5 text-left">District</th>
                  <th className="px-2 py-1.5 text-left">Submitted Time</th>
                  <th className="px-2 py-1.5 text-left">Assigned Officer</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 text-left">Priority</th>
                  <th className="px-2 py-1.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {complaints.map((complaint) => (
                  <tr key={complaint.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-2 py-1.5 font-mono text-cyan-400">{complaint.id}</td>
                    <td className="px-2 py-1.5 font-medium">{complaint.station}</td>
                    <td className="px-2 py-1.5">{complaint.type}</td>
                    <td className="px-2 py-1.5 text-slate-400">{complaint.source}</td>
                    <td className="px-2 py-1.5">{complaint.district}</td>
                    <td className="px-2 py-1.5 text-slate-400">{complaint.submitted}</td>
                    <td className="px-2 py-1.5 text-slate-400">{complaint.officer}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        complaint.status === 'Resolved' ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400' :
                        complaint.status === 'Evidence Review' ? 'bg-amber-900/30 border border-amber-600 text-amber-400' :
                        'bg-blue-900/30 border border-blue-600 text-blue-400'
                      }`}>
                        {complaint.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        complaint.priority === 'Critical' ? 'bg-red-900/30 border border-red-600 text-red-400' :
                        complaint.priority === 'High' ? 'bg-orange-900/30 border border-orange-600 text-orange-400' :
                        'bg-amber-900/30 border border-amber-600 text-amber-400'
                      }`}>
                        {complaint.priority}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button className="text-cyan-400 hover:text-cyan-300 text-xs underline">Review</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded">
          <div className="border-b border-slate-700 px-3 py-2">
            <h3 className="text-sm font-medium text-slate-200 uppercase">Recent Citizen Evidence/Media Queue</h3>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2">
              {evidenceQueue.map((item) => (
                <div key={item.id} className="bg-slate-800 border border-slate-700 rounded p-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Image className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-mono text-cyan-400">{item.id}</span>
                  </div>
                  <p className="text-xs text-slate-300 mb-1">{item.type} - {item.station}</p>
                  <p className="text-xs text-slate-500">{item.submitted}</p>
                  <button className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 underline">Review</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
