# SetSettingRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Value** | Pointer to **interface{}** | Setting value | [optional] 
**Reason** | Pointer to **string** | Reason for change (audit) | [optional] 

## Methods

### NewSetSettingRequest

`func NewSetSettingRequest() *SetSettingRequest`

NewSetSettingRequest instantiates a new SetSettingRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSetSettingRequestWithDefaults

`func NewSetSettingRequestWithDefaults() *SetSettingRequest`

NewSetSettingRequestWithDefaults instantiates a new SetSettingRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetValue

`func (o *SetSettingRequest) GetValue() interface{}`

GetValue returns the Value field if non-nil, zero value otherwise.

### GetValueOk

`func (o *SetSettingRequest) GetValueOk() (*interface{}, bool)`

GetValueOk returns a tuple with the Value field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetValue

`func (o *SetSettingRequest) SetValue(v interface{})`

SetValue sets Value field to given value.

### HasValue

`func (o *SetSettingRequest) HasValue() bool`

HasValue returns a boolean if a field has been set.

### SetValueNil

`func (o *SetSettingRequest) SetValueNil(b bool)`

 SetValueNil sets the value for Value to be an explicit nil

### UnsetValue
`func (o *SetSettingRequest) UnsetValue()`

UnsetValue ensures that no value is present for Value, not even an explicit nil
### GetReason

`func (o *SetSettingRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *SetSettingRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *SetSettingRequest) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *SetSettingRequest) HasReason() bool`

HasReason returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


