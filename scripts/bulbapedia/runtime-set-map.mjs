import vm from 'node:vm';

function extractRuntimeSetMap(source) {
  const boundary = source.indexOf('// Reverse map:');
  if (boundary < 0 || !source.slice(0, boundary).includes('const JP_TO_EN_SET_MAP')) throw new Error('JP_TO_EN_SET_MAP boundary not found');
  const mapSource = `${source.slice(0, boundary)}\nJP_TO_EN_SET_MAP;`;
  const setMap = vm.runInNewContext(mapSource, Object.create(null));
  return JSON.parse(JSON.stringify(setMap));
}

export { extractRuntimeSetMap };
