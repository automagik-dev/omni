# TestAutomation200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Matched** | **bool** |  | 
**ConditionResults** | Pointer to [**[]TestAutomation200ResponseConditionResultsInner**](TestAutomation200ResponseConditionResultsInner.md) |  | [optional] 
**WouldExecute** | Pointer to [**[]ListAutomations200ResponseItemsInnerActionsInner**](ListAutomations200ResponseItemsInnerActionsInner.md) |  | [optional] 

## Methods

### NewTestAutomation200Response

`func NewTestAutomation200Response(matched bool, ) *TestAutomation200Response`

NewTestAutomation200Response instantiates a new TestAutomation200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTestAutomation200ResponseWithDefaults

`func NewTestAutomation200ResponseWithDefaults() *TestAutomation200Response`

NewTestAutomation200ResponseWithDefaults instantiates a new TestAutomation200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetMatched

`func (o *TestAutomation200Response) GetMatched() bool`

GetMatched returns the Matched field if non-nil, zero value otherwise.

### GetMatchedOk

`func (o *TestAutomation200Response) GetMatchedOk() (*bool, bool)`

GetMatchedOk returns a tuple with the Matched field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMatched

`func (o *TestAutomation200Response) SetMatched(v bool)`

SetMatched sets Matched field to given value.


### GetConditionResults

`func (o *TestAutomation200Response) GetConditionResults() []TestAutomation200ResponseConditionResultsInner`

GetConditionResults returns the ConditionResults field if non-nil, zero value otherwise.

### GetConditionResultsOk

`func (o *TestAutomation200Response) GetConditionResultsOk() (*[]TestAutomation200ResponseConditionResultsInner, bool)`

GetConditionResultsOk returns a tuple with the ConditionResults field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConditionResults

`func (o *TestAutomation200Response) SetConditionResults(v []TestAutomation200ResponseConditionResultsInner)`

SetConditionResults sets ConditionResults field to given value.

### HasConditionResults

`func (o *TestAutomation200Response) HasConditionResults() bool`

HasConditionResults returns a boolean if a field has been set.

### GetWouldExecute

`func (o *TestAutomation200Response) GetWouldExecute() []ListAutomations200ResponseItemsInnerActionsInner`

GetWouldExecute returns the WouldExecute field if non-nil, zero value otherwise.

### GetWouldExecuteOk

`func (o *TestAutomation200Response) GetWouldExecuteOk() (*[]ListAutomations200ResponseItemsInnerActionsInner, bool)`

GetWouldExecuteOk returns a tuple with the WouldExecute field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWouldExecute

`func (o *TestAutomation200Response) SetWouldExecute(v []ListAutomations200ResponseItemsInnerActionsInner)`

SetWouldExecute sets WouldExecute field to given value.

### HasWouldExecute

`func (o *TestAutomation200Response) HasWouldExecute() bool`

HasWouldExecute returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


