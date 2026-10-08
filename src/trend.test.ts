import { describe, expect, it } from 'vitest';
import { balanceIncreases, filterElectricHistory } from './trend';
import type { ElectricHistory } from './types';

const sample: ElectricHistory = {
  campus:'DXC',unit:'元',points:[
    {updatedAt: 100*86400000,electric:20,source:'manual'},
    {updatedAt: 101*86400000,electric:18,source:'nightly'},
    {updatedAt: 102*86400000,electric:48,source:'nightly'},
    {updatedAt: 103*86400000,electric:46,source:'nightly'},
    {updatedAt: 104*86400000,electric:null,source:'unknown'}
  ]
};
describe('electric trend',()=>{
  it('filters absent balances but preserves unchanged readings',()=>{
    expect(filterElectricHistory(sample,'all').map(x=>x.electric)).toEqual([20,18,48,46]);
  });
  it('shows objective increases, not inferred recharge amounts',()=>{
    expect(balanceIncreases(filterElectricHistory(sample,'all'))).toEqual([{at:102*86400000,delta:30}]);
  });
  it('limits by actual recorded time',()=>{
    expect(filterElectricHistory(sample,2).map(x=>x.electric)).toEqual([18,48,46]);
  });
  it('never treats an absent electric balance as zero',()=>{
    expect(filterElectricHistory({ ...sample, points: [{updatedAt:101*86400000,electric:null,source:'manual'}] },'all')).toEqual([]);
  });
});
