# RequestPairingCode200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Code** | **string** | Pairing code to enter on phone | 
**PhoneNumber** | **string** | Masked phone number | 
**Message** | **string** | Instructions for user | 
**ExpiresIn** | **float32** | Seconds until code expires | 

## Methods

### NewRequestPairingCode200ResponseData

`func NewRequestPairingCode200ResponseData(code string, phoneNumber string, message string, expiresIn float32, ) *RequestPairingCode200ResponseData`

NewRequestPairingCode200ResponseData instantiates a new RequestPairingCode200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewRequestPairingCode200ResponseDataWithDefaults

`func NewRequestPairingCode200ResponseDataWithDefaults() *RequestPairingCode200ResponseData`

NewRequestPairingCode200ResponseDataWithDefaults instantiates a new RequestPairingCode200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetCode

`func (o *RequestPairingCode200ResponseData) GetCode() string`

GetCode returns the Code field if non-nil, zero value otherwise.

### GetCodeOk

`func (o *RequestPairingCode200ResponseData) GetCodeOk() (*string, bool)`

GetCodeOk returns a tuple with the Code field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCode

`func (o *RequestPairingCode200ResponseData) SetCode(v string)`

SetCode sets Code field to given value.


### GetPhoneNumber

`func (o *RequestPairingCode200ResponseData) GetPhoneNumber() string`

GetPhoneNumber returns the PhoneNumber field if non-nil, zero value otherwise.

### GetPhoneNumberOk

`func (o *RequestPairingCode200ResponseData) GetPhoneNumberOk() (*string, bool)`

GetPhoneNumberOk returns a tuple with the PhoneNumber field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhoneNumber

`func (o *RequestPairingCode200ResponseData) SetPhoneNumber(v string)`

SetPhoneNumber sets PhoneNumber field to given value.


### GetMessage

`func (o *RequestPairingCode200ResponseData) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *RequestPairingCode200ResponseData) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *RequestPairingCode200ResponseData) SetMessage(v string)`

SetMessage sets Message field to given value.


### GetExpiresIn

`func (o *RequestPairingCode200ResponseData) GetExpiresIn() float32`

GetExpiresIn returns the ExpiresIn field if non-nil, zero value otherwise.

### GetExpiresInOk

`func (o *RequestPairingCode200ResponseData) GetExpiresInOk() (*float32, bool)`

GetExpiresInOk returns a tuple with the ExpiresIn field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresIn

`func (o *RequestPairingCode200ResponseData) SetExpiresIn(v float32)`

SetExpiresIn sets ExpiresIn field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


