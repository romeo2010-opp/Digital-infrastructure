import { Search } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';
import * as Tabs from '@radix-ui/react-tabs';
import { useState } from 'react';

const stations = [
  'Shell Westlands', 'Total Mombasa Rd', 'Hashi Ngong', 'Rubis Thika', 'Kenol Nakuru',
  'Total CBD', 'Shell Karen', 'Hashi Langata', 'Rubis Parklands', 'Kenol Eldoret'
];

export function StationProfiles() {
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  return (
    <div className="flex-1 flex h-screen overflow-hidden">
      <div className="w-64 bg-slate-900 border-r border-slate-700 overflow-y-auto p-3">
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-3 h-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search station..."
              className="bg-slate-800 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300 flex-1"
            />
          </div>
        </div>
        <h3 className="text-xs text-slate-400 uppercase mb-2">Station Directory</h3>
        <div className="space-y-1">
          {stations.map((station) => (
            <button
              key={station}
              onClick={() => setSelectedStation(station)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                selectedStation === station
                  ? 'bg-cyan-900/30 border border-cyan-600 text-cyan-400'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {station}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {selectedStation ? (
          <>
            <div className="bg-slate-900 border border-slate-700 rounded p-3 mb-3">
              <h2 className="text-lg font-medium text-slate-200 mb-2">{selectedStation}</h2>
              <div className="grid grid-cols-4 gap-4 text-xs">
                <div>
                  <p className="text-slate-500">License No</p>
                  <p className="text-slate-300 font-mono">LIC-89234</p>
                </div>
                <div>
                  <p className="text-slate-500">District</p>
                  <p className="text-slate-300">Nairobi</p>
                </div>
                <div>
                  <p className="text-slate-500">Risk Score</p>
                  <p className="text-red-400 font-bold">94</p>
                </div>
                <div>
                  <p className="text-slate-500">Compliance Status</p>
                  <span className="px-2 py-0.5 bg-amber-900/30 border border-amber-600 rounded text-amber-400 text-xs">
                    Warning
                  </span>
                </div>
              </div>
            </div>

            <Tabs.Root defaultValue="license" className="bg-slate-900 border border-slate-700 rounded">
              <Tabs.List className="border-b border-slate-700 px-3 py-2 flex gap-2">
                <Tabs.Trigger
                  value="license"
                  className="px-3 py-1 text-xs rounded data-[state=active]:bg-cyan-900/30 data-[state=active]:border data-[state=active]:border-cyan-600 data-[state=active]:text-cyan-400 text-slate-400"
                >
                  License
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="complaints"
                  className="px-3 py-1 text-xs rounded data-[state=active]:bg-cyan-900/30 data-[state=active]:border data-[state=active]:border-cyan-600 data-[state=active]:text-cyan-400 text-slate-400"
                >
                  Complaints
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="inspections"
                  className="px-3 py-1 text-xs rounded data-[state=active]:bg-cyan-900/30 data-[state=active]:border data-[state=active]:border-cyan-600 data-[state=active]:text-cyan-400 text-slate-400"
                >
                  Inspections
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="deliveries"
                  className="px-3 py-1 text-xs rounded data-[state=active]:bg-cyan-900/30 data-[state=active]:border data-[state=active]:border-cyan-600 data-[state=active]:text-cyan-400 text-slate-400"
                >
                  Deliveries
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="declarations"
                  className="px-3 py-1 text-xs rounded data-[state=active]:bg-cyan-900/30 data-[state=active]:border data-[state=active]:border-cyan-600 data-[state=active]:text-cyan-400 text-slate-400"
                >
                  Declarations
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="enforcement"
                  className="px-3 py-1 text-xs rounded data-[state=active]:bg-cyan-900/30 data-[state=active]:border data-[state=active]:border-cyan-600 data-[state=active]:text-cyan-400 text-slate-400"
                >
                  Enforcement
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="risk"
                  className="px-3 py-1 text-xs rounded data-[state=active]:bg-cyan-900/30 data-[state=active]:border data-[state=active]:border-cyan-600 data-[state=active]:text-cyan-400 text-slate-400"
                >
                  Risk History
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="license" className="p-3">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="text-slate-500 mb-1">Owner</p>
                    <p className="text-slate-300">Shell Kenya Ltd</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">License No</p>
                    <p className="text-slate-300 font-mono">LIC-89234</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Issue Date</p>
                    <p className="text-slate-300">2022-03-15</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Expiry Date</p>
                    <p className="text-slate-300">2027-03-15</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Capacity</p>
                    <p className="text-slate-300">120,000L</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Pumps</p>
                    <p className="text-slate-300">12</p>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="complaints" className="p-3">
                <div className="text-xs">
                  <p className="text-slate-300 mb-2">Total Complaints: <span className="font-bold text-red-400">47</span></p>
                  <p className="text-slate-400">Most recent complaints relate to fuel hoarding and queue violence.</p>
                </div>
              </Tabs.Content>

              <Tabs.Content value="inspections" className="p-3">
                <div className="text-xs">
                  <p className="text-slate-300 mb-2">Total Inspections: <span className="font-bold text-cyan-400">23</span></p>
                  <p className="text-slate-400">Last inspection: 2024-05-05 by P. Kamau - Violation Found</p>
                </div>
              </Tabs.Content>

              <Tabs.Content value="deliveries" className="p-3">
                <div className="text-xs">
                  <p className="text-slate-300 mb-2">Total Deliveries (30 days): <span className="font-bold text-cyan-400">18</span></p>
                  <p className="text-slate-400">Last delivery: 2024-05-02 - 45,000L Diesel, 32,000L Petrol</p>
                </div>
              </Tabs.Content>

              <Tabs.Content value="declarations" className="p-3">
                <div className="text-xs">
                  <p className="text-slate-300 mb-2">Total Declarations (30 days): <span className="font-bold text-cyan-400">87</span></p>
                  <p className="text-slate-400">Mismatch rate: <span className="text-red-400 font-bold">34%</span> - significantly above threshold</p>
                </div>
              </Tabs.Content>

              <Tabs.Content value="enforcement" className="p-3">
                <div className="text-xs">
                  <p className="text-slate-300 mb-2">Total Actions: <span className="font-bold text-orange-400">5</span></p>
                  <p className="text-slate-400">Most recent: Warning Notice (ENF-1245) - Active</p>
                </div>
              </Tabs.Content>

              <Tabs.Content value="risk" className="p-3">
                <div className="text-xs">
                  <p className="text-slate-300 mb-2">Current Risk Score: <span className="font-bold text-red-400">94</span></p>
                  <p className="text-slate-400">Trend: Increasing over past 30 days</p>
                </div>
              </Tabs.Content>
            </Tabs.Root>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500">
            Select a station from the directory to view its regulatory profile
          </div>
        )}
      </div>
    </div>
  );
}
