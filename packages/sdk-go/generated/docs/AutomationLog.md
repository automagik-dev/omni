# AutomationLog

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Log UUID | 
**AutomationId** | **string** | Automation UUID | 
**EventId** | **string** | Event UUID | 
**EventType** | **string** | Event type | 
**Status** | **string** | Execution status | 
**Error** | **NullableString** | Error message | 
**ExecutedAt** | **time.Time** | Execution timestamp | 
**DurationMs** | **int32** | Duration (ms) | 

## Methods

### NewAutomationLog

`func NewAutomationLog(id string, automationId string, eventId string, eventType string, status string, error_ NullableString, executedAt time.Time, durationMs int32, ) *AutomationLog`

NewAutomationLog instantiates a new AutomationLog object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewAutomationLogWithDefaults

`func NewAutomationLogWithDefaults() *AutomationLog`

NewAutomationLogWithDefaults instantiates a new AutomationLog object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *AutomationLog) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *AutomationLog) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *AutomationLog) SetId(v string)`

SetId sets Id field to given value.


### GetAutomationId

`func (o *AutomationLog) GetAutomationId() string`

GetAutomationId returns the AutomationId field if non-nil, zero value otherwise.

### GetAutomationIdOk

`func (o *AutomationLog) GetAutomationIdOk() (*string, bool)`

GetAutomationIdOk returns a tuple with the AutomationId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAutomationId

`func (o *AutomationLog) SetAutomationId(v string)`

SetAutomationId sets AutomationId field to given value.


### GetEventId

`func (o *AutomationLog) GetEventId() string`

GetEventId returns the EventId field if non-nil, zero value otherwise.

### GetEventIdOk

`func (o *AutomationLog) GetEventIdOk() (*string, bool)`

GetEventIdOk returns a tuple with the EventId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventId

`func (o *AutomationLog) SetEventId(v string)`

SetEventId sets EventId field to given value.


### GetEventType

`func (o *AutomationLog) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *AutomationLog) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *AutomationLog) SetEventType(v string)`

SetEventType sets EventType field to given value.


### GetStatus

`func (o *AutomationLog) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *AutomationLog) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *AutomationLog) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetError

`func (o *AutomationLog) GetError() string`

GetError returns the Error field if non-nil, zero value otherwise.

### GetErrorOk

`func (o *AutomationLog) GetErrorOk() (*string, bool)`

GetErrorOk returns a tuple with the Error field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetError

`func (o *AutomationLog) SetError(v string)`

SetError sets Error field to given value.


### SetErrorNil

`func (o *AutomationLog) SetErrorNil(b bool)`

 SetErrorNil sets the value for Error to be an explicit nil

### UnsetError
`func (o *AutomationLog) UnsetError()`

UnsetError ensures that no value is present for Error, not even an explicit nil
### GetExecutedAt

`func (o *AutomationLog) GetExecutedAt() time.Time`

GetExecutedAt returns the ExecutedAt field if non-nil, zero value otherwise.

### GetExecutedAtOk

`func (o *AutomationLog) GetExecutedAtOk() (*time.Time, bool)`

GetExecutedAtOk returns a tuple with the ExecutedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExecutedAt

`func (o *AutomationLog) SetExecutedAt(v time.Time)`

SetExecutedAt sets ExecutedAt field to given value.


### GetDurationMs

`func (o *AutomationLog) GetDurationMs() int32`

GetDurationMs returns the DurationMs field if non-nil, zero value otherwise.

### GetDurationMsOk

`func (o *AutomationLog) GetDurationMsOk() (*int32, bool)`

GetDurationMsOk returns a tuple with the DurationMs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDurationMs

`func (o *AutomationLog) SetDurationMs(v int32)`

SetDurationMs sets DurationMs field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


