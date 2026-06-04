export const VEHICLE_VISUALS = [
  {
    make: 'Mazda',
    model: 'CX-5',
    vehicleType: 'SUV',
    mockupKey: 'mazda_cx5_suv',
    fallbackMockupKey: 'generic_suv',
    suggestedTankSide: null,
    confidence: 'LOW',
    silhouetteType: 'suv',
  },
  {
    make: 'Toyota',
    model: 'Corolla',
    vehicleType: 'SEDAN',
    mockupKey: 'toyota_corolla_sedan',
    fallbackMockupKey: 'generic_sedan',
    suggestedTankSide: null,
    confidence: 'LOW',
    silhouetteType: 'sedan',
  },
  {
    make: 'Toyota',
    model: 'Hilux',
    vehicleType: 'PICKUP',
    mockupKey: 'toyota_hilux_pickup',
    fallbackMockupKey: 'generic_pickup',
    suggestedTankSide: null,
    confidence: 'LOW',
    silhouetteType: 'pickup',
  },
  {
    make: 'Toyota',
    model: 'Hiace',
    vehicleType: 'MINIBUS',
    mockupKey: 'toyota_hiace_minibus',
    fallbackMockupKey: 'generic_minibus',
    suggestedTankSide: null,
    confidence: 'LOW',
    silhouetteType: 'minibus',
  },
  {
    make: 'Nissan',
    model: 'X-Trail',
    vehicleType: 'SUV',
    mockupKey: 'nissan_xtrail_suv',
    fallbackMockupKey: 'generic_suv',
    suggestedTankSide: null,
    confidence: 'LOW',
    silhouetteType: 'suv',
  },
]

const TYPE_TO_MOCKUP = {
  SEDAN: 'generic_sedan',
  HATCHBACK: 'generic_hatchback',
  SUV: 'generic_suv',
  PICKUP: 'generic_pickup',
  MINIBUS: 'generic_minibus',
  TRUCK: 'generic_truck',
  MOTORCYCLE: 'generic_motorcycle',
  OTHER: 'generic_car',
}

export function resolveVehicleVisual({ make, model, vehicleType } = {}) {
  const normalizedMake = String(make || '').trim().toLowerCase()
  const normalizedModel = String(model || '').trim().toLowerCase()
  const normalizedType = String(vehicleType || 'OTHER').trim().toUpperCase()
  const exact = VEHICLE_VISUALS.find(
    (item) =>
      item.make.toLowerCase() === normalizedMake &&
      item.model.toLowerCase() === normalizedModel,
  )
  if (exact) return { ...exact, matchType: 'MODEL' }

  const makeType = VEHICLE_VISUALS.find(
    (item) =>
      item.make.toLowerCase() === normalizedMake &&
      item.vehicleType === normalizedType,
  )
  if (makeType) return { ...makeType, mockupKey: makeType.fallbackMockupKey, matchType: 'MAKE_TYPE' }

  return {
    make: make || null,
    model: model || null,
    vehicleType: normalizedType,
    mockupKey: TYPE_TO_MOCKUP[normalizedType] || 'generic_car',
    fallbackMockupKey: 'generic_car',
    suggestedTankSide: null,
    confidence: 'LOW',
    silhouetteType: String(TYPE_TO_MOCKUP[normalizedType] || 'generic_car').replace('generic_', ''),
    matchType: 'TYPE',
  }
}
