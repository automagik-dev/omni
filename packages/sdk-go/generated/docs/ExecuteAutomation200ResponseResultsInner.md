# ExecuteAutomation200ResponseResultsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Action** | **string** |  | 
**Status** | **string** |  | 
**Result** | Pointer to **interface{}** |  | [optional] 
**Error** | Pointer to **string** |  | [optional] 
**DurationMs** | **int32** |  | 

## Methods

### NewExecuteAutomation200ResponseResultsInner

`func NewExecuteAutomation200ResponseResultsInner(action string, status string, durationMs int32, ) *ExecuteAutomation200ResponseResultsInner`

NewExecuteAutomation200ResponseResultsInner instantiates a new ExecuteAutomation200ResponseResultsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecuteAutomation200ResponseResultsInnerWithDefaults

`func NewExecuteAutomation200ResponseResultsInnerWithDefaults() *ExecuteAutomation200ResponseResultsInner`

NewExecuteAutomation200ResponseResultsInnerWithDefaults instantiates a new ExecuteAutomation200ResponseResultsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetAction

`func (o *ExecuteAutomation200ResponseResultsInner) GetAction() string`

GetAction returns the Action field if non-nil, zero value otherwise.

### GetActionOk

`func (o *ExecuteAutomation200ResponseResultsInner) GetActionOk() (*string, bool)`

GetActionOk returns a tuple with the Action field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAction

`func (o *ExecuteAutomation200ResponseResultsInner) SetAction(v string)`

SetAction sets Action field to given value.


### GetStatus

`func (o *ExecuteAutomation200ResponseResultsInner) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *ExecuteAutomation200ResponseResultsInner) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *ExecuteAutomation200ResponseResultsInner) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetResult

`func (o *ExecuteAutomation200ResponseResultsInner) GetResult() interface{}`

GetResult returns the Result field if non-nil, zero value otherwise.

### GetResultOk

`func (o *ExecuteAutomation200ResponseResultsInner) GetResultOk() (*interface{}, bool)`

GetResultOk returns a tuple with the Result field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResult

`func (o *ExecuteAutomation200ResponseResultsInner) SetResult(v interface{})`

SetResult sets Result field to given value.

### HasResult

`func (o *ExecuteAutomation200ResponseResultsInner) HasResult() bool`

HasResult returns a boolean if a field has been set.

### SetResultNil

`func (o *ExecuteAutomation200ResponseResultsInner) SetResultNil(b bool)`

 SetResultNil sets the value for Result to be an explicit nil

### UnsetResult
`func (o *ExecuteAutomation200ResponseResultsInner) UnsetResult()`

UnsetResult ensures that no value is present for Result, not even an explicit nil
### GetError

`func (o *ExecuteAutomation200ResponseResultsInner) GetError() string`

GetError returns the Error field if non-nil, zero value otherwise.

### GetErrorOk

`func (o *ExecuteAutomation200ResponseResultsInner) GetErrorOk() (*string, bool)`

GetErrorOk returns a tuple with the Error field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetError

`func (o *ExecuteAutomation200ResponseResultsInner) SetError(v string)`

SetError sets Error field to given value.

### HasError

`func (o *ExecuteAutomation200ResponseResultsInner) HasError() bool`

HasError returns a boolean if a field has been set.

### GetDurationMs

`func (o *ExecuteAutomation200ResponseResultsInner) GetDurationMs() int32`

GetDurationMs returns the DurationMs field if non-nil, zero value otherwise.

### GetDurationMsOk

`func (o *ExecuteAutomation200ResponseResultsInner) GetDurationMsOk() (*int32, bool)`

GetDurationMsOk returns a tuple with the DurationMs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDurationMs

`func (o *ExecuteAutomation200ResponseResultsInner) SetDurationMs(v int32)`

SetDurationMs sets DurationMs field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


