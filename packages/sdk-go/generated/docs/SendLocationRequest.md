# SendLocationRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID | 
**To** | **string** | Recipient | 
**Latitude** | **float32** | Latitude | 
**Longitude** | **float32** | Longitude | 
**Name** | Pointer to **string** | Location name | [optional] 
**Address** | Pointer to **string** | Address | [optional] 

## Methods

### NewSendLocationRequest

`func NewSendLocationRequest(instanceId string, to string, latitude float32, longitude float32, ) *SendLocationRequest`

NewSendLocationRequest instantiates a new SendLocationRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendLocationRequestWithDefaults

`func NewSendLocationRequestWithDefaults() *SendLocationRequest`

NewSendLocationRequestWithDefaults instantiates a new SendLocationRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *SendLocationRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SendLocationRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SendLocationRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetTo

`func (o *SendLocationRequest) GetTo() string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *SendLocationRequest) GetToOk() (*string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *SendLocationRequest) SetTo(v string)`

SetTo sets To field to given value.


### GetLatitude

`func (o *SendLocationRequest) GetLatitude() float32`

GetLatitude returns the Latitude field if non-nil, zero value otherwise.

### GetLatitudeOk

`func (o *SendLocationRequest) GetLatitudeOk() (*float32, bool)`

GetLatitudeOk returns a tuple with the Latitude field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLatitude

`func (o *SendLocationRequest) SetLatitude(v float32)`

SetLatitude sets Latitude field to given value.


### GetLongitude

`func (o *SendLocationRequest) GetLongitude() float32`

GetLongitude returns the Longitude field if non-nil, zero value otherwise.

### GetLongitudeOk

`func (o *SendLocationRequest) GetLongitudeOk() (*float32, bool)`

GetLongitudeOk returns a tuple with the Longitude field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLongitude

`func (o *SendLocationRequest) SetLongitude(v float32)`

SetLongitude sets Longitude field to given value.


### GetName

`func (o *SendLocationRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *SendLocationRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *SendLocationRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *SendLocationRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetAddress

`func (o *SendLocationRequest) GetAddress() string`

GetAddress returns the Address field if non-nil, zero value otherwise.

### GetAddressOk

`func (o *SendLocationRequest) GetAddressOk() (*string, bool)`

GetAddressOk returns a tuple with the Address field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAddress

`func (o *SendLocationRequest) SetAddress(v string)`

SetAddress sets Address field to given value.

### HasAddress

`func (o *SendLocationRequest) HasAddress() bool`

HasAddress returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


