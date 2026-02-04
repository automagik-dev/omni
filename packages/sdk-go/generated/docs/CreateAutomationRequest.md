# CreateAutomationRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** | Name | 
**Description** | Pointer to **string** | Description | [optional] 
**TriggerEventType** | **string** | Trigger event type | 
**TriggerConditions** | Pointer to [**[]ListAutomations200ResponseItemsInnerTriggerConditionsInner**](ListAutomations200ResponseItemsInnerTriggerConditionsInner.md) | Conditions | [optional] 
**ConditionLogic** | Pointer to **string** | Condition logic: \&quot;and\&quot; (all must match) or \&quot;or\&quot; (any must match) | [optional] [default to "and"]
**Actions** | [**[]ListAutomations200ResponseItemsInnerActionsInner**](ListAutomations200ResponseItemsInnerActionsInner.md) | Actions | 
**Debounce** | Pointer to [**CreateAutomationRequestDebounce**](CreateAutomationRequestDebounce.md) |  | [optional] 
**Enabled** | Pointer to **bool** | Whether enabled | [optional] [default to true]
**Priority** | Pointer to **int32** | Priority | [optional] [default to 0]

## Methods

### NewCreateAutomationRequest

`func NewCreateAutomationRequest(name string, triggerEventType string, actions []ListAutomations200ResponseItemsInnerActionsInner, ) *CreateAutomationRequest`

NewCreateAutomationRequest instantiates a new CreateAutomationRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCreateAutomationRequestWithDefaults

`func NewCreateAutomationRequestWithDefaults() *CreateAutomationRequest`

NewCreateAutomationRequestWithDefaults instantiates a new CreateAutomationRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *CreateAutomationRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *CreateAutomationRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *CreateAutomationRequest) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *CreateAutomationRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *CreateAutomationRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *CreateAutomationRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *CreateAutomationRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetTriggerEventType

`func (o *CreateAutomationRequest) GetTriggerEventType() string`

GetTriggerEventType returns the TriggerEventType field if non-nil, zero value otherwise.

### GetTriggerEventTypeOk

`func (o *CreateAutomationRequest) GetTriggerEventTypeOk() (*string, bool)`

GetTriggerEventTypeOk returns a tuple with the TriggerEventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggerEventType

`func (o *CreateAutomationRequest) SetTriggerEventType(v string)`

SetTriggerEventType sets TriggerEventType field to given value.


### GetTriggerConditions

`func (o *CreateAutomationRequest) GetTriggerConditions() []ListAutomations200ResponseItemsInnerTriggerConditionsInner`

GetTriggerConditions returns the TriggerConditions field if non-nil, zero value otherwise.

### GetTriggerConditionsOk

`func (o *CreateAutomationRequest) GetTriggerConditionsOk() (*[]ListAutomations200ResponseItemsInnerTriggerConditionsInner, bool)`

GetTriggerConditionsOk returns a tuple with the TriggerConditions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggerConditions

`func (o *CreateAutomationRequest) SetTriggerConditions(v []ListAutomations200ResponseItemsInnerTriggerConditionsInner)`

SetTriggerConditions sets TriggerConditions field to given value.

### HasTriggerConditions

`func (o *CreateAutomationRequest) HasTriggerConditions() bool`

HasTriggerConditions returns a boolean if a field has been set.

### GetConditionLogic

`func (o *CreateAutomationRequest) GetConditionLogic() string`

GetConditionLogic returns the ConditionLogic field if non-nil, zero value otherwise.

### GetConditionLogicOk

`func (o *CreateAutomationRequest) GetConditionLogicOk() (*string, bool)`

GetConditionLogicOk returns a tuple with the ConditionLogic field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConditionLogic

`func (o *CreateAutomationRequest) SetConditionLogic(v string)`

SetConditionLogic sets ConditionLogic field to given value.

### HasConditionLogic

`func (o *CreateAutomationRequest) HasConditionLogic() bool`

HasConditionLogic returns a boolean if a field has been set.

### GetActions

`func (o *CreateAutomationRequest) GetActions() []ListAutomations200ResponseItemsInnerActionsInner`

GetActions returns the Actions field if non-nil, zero value otherwise.

### GetActionsOk

`func (o *CreateAutomationRequest) GetActionsOk() (*[]ListAutomations200ResponseItemsInnerActionsInner, bool)`

GetActionsOk returns a tuple with the Actions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetActions

`func (o *CreateAutomationRequest) SetActions(v []ListAutomations200ResponseItemsInnerActionsInner)`

SetActions sets Actions field to given value.


### GetDebounce

`func (o *CreateAutomationRequest) GetDebounce() CreateAutomationRequestDebounce`

GetDebounce returns the Debounce field if non-nil, zero value otherwise.

### GetDebounceOk

`func (o *CreateAutomationRequest) GetDebounceOk() (*CreateAutomationRequestDebounce, bool)`

GetDebounceOk returns a tuple with the Debounce field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDebounce

`func (o *CreateAutomationRequest) SetDebounce(v CreateAutomationRequestDebounce)`

SetDebounce sets Debounce field to given value.

### HasDebounce

`func (o *CreateAutomationRequest) HasDebounce() bool`

HasDebounce returns a boolean if a field has been set.

### GetEnabled

`func (o *CreateAutomationRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *CreateAutomationRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *CreateAutomationRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *CreateAutomationRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.

### GetPriority

`func (o *CreateAutomationRequest) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *CreateAutomationRequest) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *CreateAutomationRequest) SetPriority(v int32)`

SetPriority sets Priority field to given value.

### HasPriority

`func (o *CreateAutomationRequest) HasPriority() bool`

HasPriority returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


