# GetAutomationMetrics200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Running** | **bool** | Engine running | 
**TotalAutomations** | **int32** | Total automations | 
**EnabledAutomations** | **int32** | Enabled automations | 
**EventsProcessed** | **int32** | Events processed | 
**ActionsExecuted** | **int32** | Actions executed | 
**FailedActions** | **int32** | Failed actions | 

## Methods

### NewGetAutomationMetrics200Response

`func NewGetAutomationMetrics200Response(running bool, totalAutomations int32, enabledAutomations int32, eventsProcessed int32, actionsExecuted int32, failedActions int32, ) *GetAutomationMetrics200Response`

NewGetAutomationMetrics200Response instantiates a new GetAutomationMetrics200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetAutomationMetrics200ResponseWithDefaults

`func NewGetAutomationMetrics200ResponseWithDefaults() *GetAutomationMetrics200Response`

NewGetAutomationMetrics200ResponseWithDefaults instantiates a new GetAutomationMetrics200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetRunning

`func (o *GetAutomationMetrics200Response) GetRunning() bool`

GetRunning returns the Running field if non-nil, zero value otherwise.

### GetRunningOk

`func (o *GetAutomationMetrics200Response) GetRunningOk() (*bool, bool)`

GetRunningOk returns a tuple with the Running field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRunning

`func (o *GetAutomationMetrics200Response) SetRunning(v bool)`

SetRunning sets Running field to given value.


### GetTotalAutomations

`func (o *GetAutomationMetrics200Response) GetTotalAutomations() int32`

GetTotalAutomations returns the TotalAutomations field if non-nil, zero value otherwise.

### GetTotalAutomationsOk

`func (o *GetAutomationMetrics200Response) GetTotalAutomationsOk() (*int32, bool)`

GetTotalAutomationsOk returns a tuple with the TotalAutomations field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalAutomations

`func (o *GetAutomationMetrics200Response) SetTotalAutomations(v int32)`

SetTotalAutomations sets TotalAutomations field to given value.


### GetEnabledAutomations

`func (o *GetAutomationMetrics200Response) GetEnabledAutomations() int32`

GetEnabledAutomations returns the EnabledAutomations field if non-nil, zero value otherwise.

### GetEnabledAutomationsOk

`func (o *GetAutomationMetrics200Response) GetEnabledAutomationsOk() (*int32, bool)`

GetEnabledAutomationsOk returns a tuple with the EnabledAutomations field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabledAutomations

`func (o *GetAutomationMetrics200Response) SetEnabledAutomations(v int32)`

SetEnabledAutomations sets EnabledAutomations field to given value.


### GetEventsProcessed

`func (o *GetAutomationMetrics200Response) GetEventsProcessed() int32`

GetEventsProcessed returns the EventsProcessed field if non-nil, zero value otherwise.

### GetEventsProcessedOk

`func (o *GetAutomationMetrics200Response) GetEventsProcessedOk() (*int32, bool)`

GetEventsProcessedOk returns a tuple with the EventsProcessed field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventsProcessed

`func (o *GetAutomationMetrics200Response) SetEventsProcessed(v int32)`

SetEventsProcessed sets EventsProcessed field to given value.


### GetActionsExecuted

`func (o *GetAutomationMetrics200Response) GetActionsExecuted() int32`

GetActionsExecuted returns the ActionsExecuted field if non-nil, zero value otherwise.

### GetActionsExecutedOk

`func (o *GetAutomationMetrics200Response) GetActionsExecutedOk() (*int32, bool)`

GetActionsExecutedOk returns a tuple with the ActionsExecuted field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetActionsExecuted

`func (o *GetAutomationMetrics200Response) SetActionsExecuted(v int32)`

SetActionsExecuted sets ActionsExecuted field to given value.


### GetFailedActions

`func (o *GetAutomationMetrics200Response) GetFailedActions() int32`

GetFailedActions returns the FailedActions field if non-nil, zero value otherwise.

### GetFailedActionsOk

`func (o *GetAutomationMetrics200Response) GetFailedActionsOk() (*int32, bool)`

GetFailedActionsOk returns a tuple with the FailedActions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFailedActions

`func (o *GetAutomationMetrics200Response) SetFailedActions(v int32)`

SetFailedActions sets FailedActions field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


