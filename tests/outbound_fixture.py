from recovery_fixture import insert

def outbound_sql():
    now=1700000000000
    return '\n'.join([
        insert('CommunicationTemplate',id='comm-template-1',company='Petronik',name='Fictional enquiry',channel='email',subject='Hello {{contact}}',body='Fictional follow-up for {{record}}',createdBy='recovery-user',version=1,archived=0,createdAt=now),
        insert('OutboundMessage',id='comm-message-1',ownerId='recovery-user',recordId='legacy',company='Petronik',branch='Main',channel='email',recipient='fictional@example.invalid',subject='Fictional follow-up',body='Fictional; quotes \' and unicode Δ',templateId='comm-template-1',status='draft',version=1,scheduledAt=None,createdAt=now,updatedAt=now,providerId=None,consent=''),
        "UPDATE OutboundMessage SET status='ready',version=2 WHERE id='comm-message-1';",
        "UPDATE OutboundMessage SET status='sending',version=3,consent='Fictional test permission' WHERE id='comm-message-1';",
        "UPDATE OutboundMessage SET status='captured',version=4 WHERE id='comm-message-1';",
        insert('OutboundEvent',id='comm-event-1',messageId='comm-message-1',action='Fictional capture · not delivered',at=now),
    ])+'\n'
