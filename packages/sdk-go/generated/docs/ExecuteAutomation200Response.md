# ExecuteAutomation200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**AutomationId** | **string** |  | 
**Triggered** | **bool** | Whether the automation was triggered (event type matched) | 
**Results** | [**[]ExecuteAutomation200ResponseResultsInner**](ExecuteAutomation200ResponseResultsInner.md) | Results of each action execution | 

## Methods

### NewExecuteAutomation200Response

`func NewExecuteAutomation200Response(automationId string, triggered bool, results []ExecuteAutomation200ResponseResultsInner, ) *ExecuteAutomation200Response`

NewExecuteAutomation200Response instantiates a new ExecuteAutomation200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecuteAutomation200ResponseWithDefaults

`func NewExecuteAutomation200ResponseWithDefaults() *ExecuteAutomation200Response`

NewExecuteAutomation200ResponseWithDefaults instantiates a new ExecuteAutomation200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetAutomationId

`func (o *ExecuteAutomation200Response) GetAutomationId() string`

GetAutomationId returns the AutomationId field if non-nil, zero value otherwise.

### GetAutomationIdOk

`func (o *ExecuteAutomation200Response) GetAutomationIdOk() (*string, bool)`

GetAutomationIdOk returns a tuple with the AutomationId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAutomationId

`func (o *ExecuteAutomation200Response) SetAutomationId(v string)`

SetAutomationId sets AutomationId field to given value.


### GetTriggered

`func (o *ExecuteAutomation200Response) GetTriggered() bool`

GetTriggered returns the Triggered field if non-nil, zero value otherwise.

### GetTriggeredOk

`func (o *ExecuteAutomation200Response) GetTriggeredOk() (*bool, bool)`

GetTriggeredOk returns a tuple with the Triggered field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggered

`func (o *ExecuteAutomation200Response) SetTriggered(v bool)`

SetTriggered sets Triggered field to given value.


### GetResults

`func (o *ExecuteAutomation200Response) GetResults() []ExecuteAutomation200ResponseResultsInner`

GetResults returns the Results field if non-nil, zero value otherwise.

### GetResultsOk

`func (o *ExecuteAutomation200Response) GetResultsOk() (*[]ExecuteAutomation200ResponseResultsInner, bool)`

GetResultsOk returns a tuple with the Results field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResults

`func (o *ExecuteAutomation200Response) SetResults(v []ExecuteAutomation200ResponseResultsInner)`

SetResults sets Results field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


