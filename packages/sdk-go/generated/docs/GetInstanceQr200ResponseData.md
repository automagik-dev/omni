# GetInstanceQr200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Qr** | **NullableString** | QR code string | 
**ExpiresAt** | **NullableTime** | QR code expiration | 
**Message** | **string** | Status message | 

## Methods

### NewGetInstanceQr200ResponseData

`func NewGetInstanceQr200ResponseData(qr NullableString, expiresAt NullableTime, message string, ) *GetInstanceQr200ResponseData`

NewGetInstanceQr200ResponseData instantiates a new GetInstanceQr200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetInstanceQr200ResponseDataWithDefaults

`func NewGetInstanceQr200ResponseDataWithDefaults() *GetInstanceQr200ResponseData`

NewGetInstanceQr200ResponseDataWithDefaults instantiates a new GetInstanceQr200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetQr

`func (o *GetInstanceQr200ResponseData) GetQr() string`

GetQr returns the Qr field if non-nil, zero value otherwise.

### GetQrOk

`func (o *GetInstanceQr200ResponseData) GetQrOk() (*string, bool)`

GetQrOk returns a tuple with the Qr field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQr

`func (o *GetInstanceQr200ResponseData) SetQr(v string)`

SetQr sets Qr field to given value.


### SetQrNil

`func (o *GetInstanceQr200ResponseData) SetQrNil(b bool)`

 SetQrNil sets the value for Qr to be an explicit nil

### UnsetQr
`func (o *GetInstanceQr200ResponseData) UnsetQr()`

UnsetQr ensures that no value is present for Qr, not even an explicit nil
### GetExpiresAt

`func (o *GetInstanceQr200ResponseData) GetExpiresAt() time.Time`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *GetInstanceQr200ResponseData) GetExpiresAtOk() (*time.Time, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *GetInstanceQr200ResponseData) SetExpiresAt(v time.Time)`

SetExpiresAt sets ExpiresAt field to given value.


### SetExpiresAtNil

`func (o *GetInstanceQr200ResponseData) SetExpiresAtNil(b bool)`

 SetExpiresAtNil sets the value for ExpiresAt to be an explicit nil

### UnsetExpiresAt
`func (o *GetInstanceQr200ResponseData) UnsetExpiresAt()`

UnsetExpiresAt ensures that no value is present for ExpiresAt, not even an explicit nil
### GetMessage

`func (o *GetInstanceQr200ResponseData) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *GetInstanceQr200ResponseData) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *GetInstanceQr200ResponseData) SetMessage(v string)`

SetMessage sets Message field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


