# GetSettingHistory200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**OldValue** | **NullableString** | Old value (masked) | 
**NewValue** | **NullableString** | New value (masked) | 
**ChangedBy** | **string** | Who made the change | 
**ChangedAt** | **time.Time** | When changed | 
**ChangeReason** | **NullableString** | Reason for change | 

## Methods

### NewGetSettingHistory200ResponseItemsInner

`func NewGetSettingHistory200ResponseItemsInner(oldValue NullableString, newValue NullableString, changedBy string, changedAt time.Time, changeReason NullableString, ) *GetSettingHistory200ResponseItemsInner`

NewGetSettingHistory200ResponseItemsInner instantiates a new GetSettingHistory200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetSettingHistory200ResponseItemsInnerWithDefaults

`func NewGetSettingHistory200ResponseItemsInnerWithDefaults() *GetSettingHistory200ResponseItemsInner`

NewGetSettingHistory200ResponseItemsInnerWithDefaults instantiates a new GetSettingHistory200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetOldValue

`func (o *GetSettingHistory200ResponseItemsInner) GetOldValue() string`

GetOldValue returns the OldValue field if non-nil, zero value otherwise.

### GetOldValueOk

`func (o *GetSettingHistory200ResponseItemsInner) GetOldValueOk() (*string, bool)`

GetOldValueOk returns a tuple with the OldValue field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOldValue

`func (o *GetSettingHistory200ResponseItemsInner) SetOldValue(v string)`

SetOldValue sets OldValue field to given value.


### SetOldValueNil

`func (o *GetSettingHistory200ResponseItemsInner) SetOldValueNil(b bool)`

 SetOldValueNil sets the value for OldValue to be an explicit nil

### UnsetOldValue
`func (o *GetSettingHistory200ResponseItemsInner) UnsetOldValue()`

UnsetOldValue ensures that no value is present for OldValue, not even an explicit nil
### GetNewValue

`func (o *GetSettingHistory200ResponseItemsInner) GetNewValue() string`

GetNewValue returns the NewValue field if non-nil, zero value otherwise.

### GetNewValueOk

`func (o *GetSettingHistory200ResponseItemsInner) GetNewValueOk() (*string, bool)`

GetNewValueOk returns a tuple with the NewValue field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetNewValue

`func (o *GetSettingHistory200ResponseItemsInner) SetNewValue(v string)`

SetNewValue sets NewValue field to given value.


### SetNewValueNil

`func (o *GetSettingHistory200ResponseItemsInner) SetNewValueNil(b bool)`

 SetNewValueNil sets the value for NewValue to be an explicit nil

### UnsetNewValue
`func (o *GetSettingHistory200ResponseItemsInner) UnsetNewValue()`

UnsetNewValue ensures that no value is present for NewValue, not even an explicit nil
### GetChangedBy

`func (o *GetSettingHistory200ResponseItemsInner) GetChangedBy() string`

GetChangedBy returns the ChangedBy field if non-nil, zero value otherwise.

### GetChangedByOk

`func (o *GetSettingHistory200ResponseItemsInner) GetChangedByOk() (*string, bool)`

GetChangedByOk returns a tuple with the ChangedBy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChangedBy

`func (o *GetSettingHistory200ResponseItemsInner) SetChangedBy(v string)`

SetChangedBy sets ChangedBy field to given value.


### GetChangedAt

`func (o *GetSettingHistory200ResponseItemsInner) GetChangedAt() time.Time`

GetChangedAt returns the ChangedAt field if non-nil, zero value otherwise.

### GetChangedAtOk

`func (o *GetSettingHistory200ResponseItemsInner) GetChangedAtOk() (*time.Time, bool)`

GetChangedAtOk returns a tuple with the ChangedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChangedAt

`func (o *GetSettingHistory200ResponseItemsInner) SetChangedAt(v time.Time)`

SetChangedAt sets ChangedAt field to given value.


### GetChangeReason

`func (o *GetSettingHistory200ResponseItemsInner) GetChangeReason() string`

GetChangeReason returns the ChangeReason field if non-nil, zero value otherwise.

### GetChangeReasonOk

`func (o *GetSettingHistory200ResponseItemsInner) GetChangeReasonOk() (*string, bool)`

GetChangeReasonOk returns a tuple with the ChangeReason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChangeReason

`func (o *GetSettingHistory200ResponseItemsInner) SetChangeReason(v string)`

SetChangeReason sets ChangeReason field to given value.


### SetChangeReasonNil

`func (o *GetSettingHistory200ResponseItemsInner) SetChangeReasonNil(b bool)`

 SetChangeReasonNil sets the value for ChangeReason to be an explicit nil

### UnsetChangeReason
`func (o *GetSettingHistory200ResponseItemsInner) UnsetChangeReason()`

UnsetChangeReason ensures that no value is present for ChangeReason, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


