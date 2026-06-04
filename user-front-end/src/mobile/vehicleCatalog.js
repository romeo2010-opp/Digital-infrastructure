export const VEHICLE_TYPES = [
  'SEDAN',
  'HATCHBACK',
  'SUV',
  'PICKUP',
  'MINIBUS',
  'TRUCK',
  'MOTORCYCLE',
  'OTHER',
]

export const VEHICLE_USAGE_TYPES = [
  'PRIVATE',
  'TAXI',
  'FLEET',
  'COMPANY',
  'PUBLIC_TRANSPORT',
  'OTHER',
]

export const FUEL_TYPES = ['PETROL', 'DIESEL']

export const VEHICLE_MAKES = [
  'Toyota',
  'Nissan',
  'Mazda',
  'Honda',
  'Subaru',
  'Mitsubishi',
  'Isuzu',
  'Ford',
  'Hyundai',
  'Kia',
  'Mercedes-Benz',
  'BMW',
  'Volkswagen',
  'Suzuki',
  'Other',
]

export const VEHICLE_MODELS_BY_MAKE = {
  Toyota: ['Corolla', 'Hilux', 'Hiace', 'RAV4', 'Fortuner', 'Land Cruiser', 'Yaris', 'Other'],
  Nissan: ['X-Trail', 'Navara', 'NP200', 'Patrol', 'Note', 'Other'],
  Mazda: ['CX-5', 'Demio', 'BT-50', 'Axela', 'CX-3', 'Other'],
  Honda: ['Fit', 'Civic', 'CR-V', 'Accord', 'Other'],
  Subaru: ['Forester', 'Outback', 'Impreza', 'XV', 'Other'],
  Mitsubishi: ['Pajero', 'L200', 'Outlander', 'RVR', 'Other'],
  Isuzu: ['D-Max', 'KB', 'N-Series', 'Other'],
  Ford: ['Ranger', 'Everest', 'Focus', 'Fiesta', 'Other'],
  Hyundai: ['Tucson', 'Santa Fe', 'i20', 'H-1', 'Other'],
  Kia: ['Sportage', 'Sorento', 'Picanto', 'Rio', 'Other'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'Sprinter', 'Actros', 'Other'],
  BMW: ['3 Series', '5 Series', 'X3', 'X5', 'Other'],
  Volkswagen: ['Polo', 'Golf', 'Amarok', 'Tiguan', 'Other'],
  Suzuki: ['Swift', 'Vitara', 'Jimny', 'Baleno', 'Other'],
  Other: ['Other'],
}

export function displayEnum(value) {
  return String(value || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function normalizePlate(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
}
