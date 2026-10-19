"""Fictional Phase 9 ledger for isolated recovery tests only."""
from recovery_fixture import insert

def operations_sql():
    now=1700000000000
    return '\n'.join([
        insert('User',id='operations-approver',email='approver@example.test',name='Fictional Approver',passwordHash='unusable',role='MD',companies='["Petronik"]',branches='[]',moduleAccess='{}',active=1,createdAt=now),
        "UPDATE BusinessRecord SET status='Confirmed',payload=json_set(payload,'$.status','Confirmed') WHERE id='o-a';",
        insert('PurchaseOrder',id='po-r1',company='Petronik',branch='Main',orderId='o-a',supplierId='s-a',productId='p-a',warehouse='Dubai',unit='MT',quantity=10000000,priceCents=10000,totalCents=100000,currency='USD',status='Draft',expectedDate='2026-11-01',notes="Fictional Δ; 'quoted'",createdBy='recovery-user',approvedBy=None,version=1,createdAt=now,updatedAt=now),
        "UPDATE PurchaseOrder SET status='Approved',approvedBy='operations-approver',version=2 WHERE id='po-r1';",
        insert('StockMovement',id='z-receipt',purchaseId='po-r1',kind='Receipt',quantity=4000000,shipmentId=None,reversalOf=None,reference='Receipt 1',date='2026-11-02',notes='',createdBy='recovery-user',createdAt=now),
        insert('StockMovement',id='z-dispatch',purchaseId='po-r1',kind='Dispatch',quantity=-1000000,shipmentId='shp-a',reversalOf=None,reference='Dispatch 1',date='2026-11-02',notes='',createdBy='recovery-user',createdAt=now),
        insert('StockMovement',id='a-reversal',purchaseId='po-r1',kind='Dispatch reversal',quantity=1000000,shipmentId='shp-a',reversalOf='z-dispatch',reference='Correction',date='2026-11-03',notes='Fictional correction',createdBy='recovery-user',createdAt=now),
        insert('SupplierInvoice',id='bill-r1',purchaseId='po-r1',company='Petronik',supplierId='s-a',reference='SUP-1',normalized='sup-1',amountCents=20000,date='2026-11-02',dueDate='2026-11-30',notes='',createdBy='recovery-user',createdAt=now),
        insert('SupplierPayment',id='pay-r1',invoiceId='bill-r1',amountCents=10000,reference='BANK-1',date='2026-11-03',notes='',createdBy='recovery-user',createdAt=now),
    ])+'\n'
