# ListAutomations200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Automation UUID | 
**Name** | **string** | Name | 
**Description** | **NullableString** | Description | 
**TriggerEventType** | **string** | Trigger event type | 
**TriggerConditions** | [**[]ListAutomations200ResponseItemsInnerTriggerConditionsInner**](ListAutomations200ResponseItemsInnerTriggerConditionsInner.md) | Conditions | 
**ConditionLogic** | **NullableString** | Condition logic | 
**Actions** | [**[]ListAutomations200ResponseItemsInnerActionsInner**](ListAutomations200ResponseItemsInnerActionsInner.md) | Actions | 
**Debounce** | [**NullableListAutomations200ResponseItemsInnerDebounce**](ListAutomations200ResponseItemsInnerDebounce.md) |  | 
**Enabled** | **bool** | Whether enabled | 
**Priority** | **int32** | Priority | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewListAutomations200ResponseItemsInner

`func NewListAutomations200ResponseItemsInner(id string, name string, description NullableString, triggerEventType string, triggerConditions []ListAutomations200ResponseItemsInnerTriggerConditionsInner, conditionLogic NullableString, actions []ListAutomations200ResponseItemsInnerActionsInner, debounce NullableListAutomations200ResponseItemsInnerDebounce, enabled bool, priority int32, createdAt time.Time, updatedAt time.Time, ) *ListAutomations200ResponseItemsInner`

NewListAutomations200ResponseItemsInner instantiates a new ListAutomations200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListAutomations200ResponseItemsInnerWithDefaults

`func NewListAutomations200ResponseItemsInnerWithDefaults() *ListAutomations200ResponseItemsInner`

NewListAutomations200ResponseItemsInnerWithDefaults instantiates a new ListAutomations200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ListAutomations200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ListAutomations200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ListAutomations200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *ListAutomations200ResponseItemsInner) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *ListAutomations200ResponseItemsInner) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *ListAutomations200ResponseItemsInner) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *ListAutomations200ResponseItemsInner) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *ListAutomations200ResponseItemsInner) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *ListAutomations200ResponseItemsInner) SetDescription(v string)`

SetDescription sets Description field to given value.


### SetDescriptionNil

`func (o *ListAutomations200ResponseItemsInner) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *ListAutomations200ResponseItemsInner) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetTriggerEventType

`func (o *ListAutomations200ResponseItemsInner) GetTriggerEventType() string`

GetTriggerEventType returns the TriggerEventType field if non-nil, zero value otherwise.

### GetTriggerEventTypeOk

`func (o *ListAutomations200ResponseItemsInner) GetTriggerEventTypeOk() (*string, bool)`

GetTriggerEventTypeOk returns a tuple with the TriggerEventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggerEventType

`func (o *ListAutomations200ResponseItemsInner) SetTriggerEventType(v string)`

SetTriggerEventType sets TriggerEventType field to given value.


### GetTriggerConditions

`func (o *ListAutomations200ResponseItemsInner) GetTriggerConditions() []ListAutomations200ResponseItemsInnerTriggerConditionsInner`

GetTriggerConditions returns the TriggerConditions field if non-nil, zero value otherwise.

### GetTriggerConditionsOk

`func (o *ListAutomations200ResponseItemsInner) GetTriggerConditionsOk() (*[]ListAutomations200ResponseItemsInnerTriggerConditionsInner, bool)`

GetTriggerConditionsOk returns a tuple with the TriggerConditions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggerConditions

`func (o *ListAutomations200ResponseItemsInner) SetTriggerConditions(v []ListAutomations200ResponseItemsInnerTriggerConditionsInner)`

SetTriggerConditions sets TriggerConditions field to given value.


### SetTriggerConditionsNil

`func (o *ListAutomations200ResponseItemsInner) SetTriggerConditionsNil(b bool)`

 SetTriggerConditionsNil sets the value for TriggerConditions to be an explicit nil

### UnsetTriggerConditions
`func (o *ListAutomations200ResponseItemsInner) UnsetTriggerConditions()`

UnsetTriggerConditions ensures that no value is present for TriggerConditions, not even an explicit nil
### GetConditionLogic

`func (o *ListAutomations200ResponseItemsInner) GetConditionLogic() string`

GetConditionLogic returns the ConditionLogic field if non-nil, zero value otherwise.

### GetConditionLogicOk

`func (o *ListAutomations200ResponseItemsInner) GetConditionLogicOk() (*string, bool)`

GetConditionLogicOk returns a tuple with the ConditionLogic field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConditionLogic

`func (o *ListAutomations200ResponseItemsInner) SetConditionLogic(v string)`

SetConditionLogic sets ConditionLogic field to given value.


### SetConditionLogicNil

`func (o *ListAutomations200ResponseItemsInner) SetConditionLogicNil(b bool)`

 SetConditionLogicNil sets the value for ConditionLogic to be an explicit nil

### UnsetConditionLogic
`func (o *ListAutomations200ResponseItemsInner) UnsetConditionLogic()`

UnsetConditionLogic ensures that no value is present for ConditionLogic, not even an explicit nil
### GetActions

`func (o *ListAutomations200ResponseItemsInner) GetActions() []ListAutomations200ResponseItemsInnerActionsInner`

GetActions returns the Actions field if non-nil, zero value otherwise.

### GetActionsOk

`func (o *ListAutomations200ResponseItemsInner) GetActionsOk() (*[]ListAutomations200ResponseItemsInnerActionsInner, bool)`

GetActionsOk returns a tuple with the Actions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetActions

`func (o *ListAutomations200ResponseItemsInner) SetActions(v []ListAutomations200ResponseItemsInnerActionsInner)`

SetActions sets Actions field to given value.


### GetDebounce

`func (o *ListAutomations200ResponseItemsInner) GetDebounce() ListAutomations200ResponseItemsInnerDebounce`

GetDebounce returns the Debounce field if non-nil, zero value otherwise.

### GetDebounceOk

`func (o *ListAutomations200ResponseItemsInner) GetDebounceOk() (*ListAutomations200ResponseItemsInnerDebounce, bool)`

GetDebounceOk returns a tuple with the Debounce field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDebounce

`func (o *ListAutomations200ResponseItemsInner) SetDebounce(v ListAutomations200ResponseItemsInnerDebounce)`

SetDebounce sets Debounce field to given value.


### SetDebounceNil

`func (o *ListAutomations200ResponseItemsInner) SetDebounceNil(b bool)`

 SetDebounceNil sets the value for Debounce to be an explicit nil

### UnsetDebounce
`func (o *ListAutomations200ResponseItemsInner) UnsetDebounce()`

UnsetDebounce ensures that no value is present for Debounce, not even an explicit nil
### GetEnabled

`func (o *ListAutomations200ResponseItemsInner) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *ListAutomations200ResponseItemsInner) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *ListAutomations200ResponseItemsInner) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.


### GetPriority

`func (o *ListAutomations200ResponseItemsInner) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *ListAutomations200ResponseItemsInner) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *ListAutomations200ResponseItemsInner) SetPriority(v int32)`

SetPriority sets Priority field to given value.


### GetCreatedAt

`func (o *ListAutomations200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *ListAutomations200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *ListAutomations200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *ListAutomations200ResponseItemsInner) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *ListAutomations200ResponseItemsInner) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *ListAutomations200ResponseItemsInner) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


